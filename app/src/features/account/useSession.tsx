import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import { supabase } from '../../lib/supabase';

export type SessionStatus = 'loading' | 'signed_out' | 'needs_profile' | 'ready';

export interface SessionProfile {
  firstName: string;
  language: 'fr' | 'en';
  photoUrl: string | null;
  bio: string | null;
}

export interface SessionValue {
  status: SessionStatus;
  userId: string | null;
  profile: SessionProfile | null;
  /** True when the profile could not be fetched (status stays 'loading' while it is retried). */
  error: boolean;
  /** Re-reads the session and profile once; resolves with the settled status ('loading' on failure). */
  refresh(): Promise<SessionStatus>;
}

/** Delays before each automatic retry of a failed profile fetch; later retries wait for the app to return to the foreground. */
const RETRY_DELAYS_MS = [2000, 5000, 15000];

const SessionContext = createContext<SessionValue>({
  status: 'loading',
  userId: null,
  profile: null,
  error: false,
  refresh: async () => 'loading',
});

interface Loaded {
  userId: string | null;
  profile: SessionProfile | null;
  needsProfile: boolean;
  failed: boolean;
}

async function loadProfile(userId: string): Promise<Loaded> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('first_name, age_confirmed, language, photo_url, bio')
      .eq('id', userId)
      .maybeSingle();
    if (error) return { userId, profile: null, needsProfile: false, failed: true };
    if (!data) return { userId, profile: null, needsProfile: true, failed: false };
    const profile: SessionProfile = {
      firstName: data.first_name,
      language: data.language === 'en' ? 'en' : 'fr',
      photoUrl: data.photo_url,
      bio: data.bio,
    };
    const needsProfile = data.first_name.trim() === '' || !data.age_confirmed;
    return { userId, profile, needsProfile, failed: false };
  } catch {
    return { userId, profile: null, needsProfile: false, failed: true };
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  // undefined: not known yet; null: signed out.
  const [authUserId, setAuthUserId] = useState<string | null | undefined>(undefined);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const inflight = useRef<{ userId: string; promise: Promise<Loaded> } | null>(null);
  const failedRef = useRef(false);

  // One fetch per user at a time: concurrent callers share the same request.
  const loadOnce = useCallback((userId: string): Promise<Loaded> => {
    if (inflight.current?.userId === userId) return inflight.current.promise;
    const promise = loadProfile(userId).finally(() => {
      if (inflight.current?.promise === promise) inflight.current = null;
    });
    inflight.current = { userId, promise };
    return promise;
  }, []);

  useEffect(() => {
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => active && setAuthUserId(data.session?.user.id ?? null))
      .catch(() => active && setAuthUserId(null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      // No Supabase call here: the callback runs inside the auth lock.
      setAuthUserId(session?.user.id ?? null);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authUserId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = async (i: number) => {
      const l = await loadOnce(authUserId);
      if (!active) return;
      failedRef.current = l.failed;
      setLoaded(l);
      if (l.failed && i < RETRY_DELAYS_MS.length) {
        timer = setTimeout(() => attempt(i + 1), RETRY_DELAYS_MS[i]);
      }
    };
    attempt(0);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active' && failedRef.current) {
        clearTimeout(timer);
        attempt(RETRY_DELAYS_MS.length);
      }
    });
    return () => {
      active = false;
      clearTimeout(timer);
      appState.remove();
    };
  }, [authUserId, loadOnce]);

  const refresh = useCallback(async (): Promise<SessionStatus> => {
    try {
      const { data } = await supabase.auth.getSession();
      const id = data.session?.user.id ?? null;
      setAuthUserId(id);
      if (!id) return 'signed_out';
      const l = await loadOnce(id);
      failedRef.current = l.failed;
      setLoaded(l);
      if (l.failed) return 'loading';
      return l.needsProfile ? 'needs_profile' : 'ready';
    } catch {
      return 'loading';
    }
  }, [loadOnce]);

  const value = useMemo<SessionValue>(() => {
    if (authUserId === undefined) {
      return { status: 'loading', userId: null, profile: null, error: false, refresh };
    }
    if (authUserId === null) {
      return { status: 'signed_out', userId: null, profile: null, error: false, refresh };
    }
    if (!loaded || loaded.userId !== authUserId || loaded.failed) {
      const error = !!loaded && loaded.userId === authUserId && loaded.failed;
      return { status: 'loading', userId: authUserId, profile: null, error, refresh };
    }
    return {
      status: loaded.needsProfile ? 'needs_profile' : 'ready',
      userId: authUserId,
      profile: loaded.profile,
      error: false,
      refresh,
    };
  }, [authUserId, loaded, refresh]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  return useContext(SessionContext);
}
