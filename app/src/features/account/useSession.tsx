import { clearOutbox, flush } from '../chat/outbox';
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
  homeAreaLabel: string | null;
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
      .select('first_name, age_confirmed, language, photo_url, bio, home_area_label')
      .eq('id', userId)
      .maybeSingle();
    if (error) return { userId, profile: null, needsProfile: false, failed: true };
    if (!data) return { userId, profile: null, needsProfile: true, failed: false };
    const profile: SessionProfile = {
      firstName: data.first_name,
      language: data.language === 'en' ? 'en' : 'fr',
      photoUrl: data.photo_url,
      bio: data.bio,
      homeAreaLabel: data.home_area_label,
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
  const sessionFailedRef = useRef(false);
  const [sessionFailed, setSessionFailed] = useState(false);

  // One fetch per user at a time: concurrent callers share the same request.
  const loadOnce = useCallback((userId: string): Promise<Loaded> => {
    if (inflight.current?.userId === userId) return inflight.current.promise;
    const promise = loadProfile(userId).finally(() => {
      if (inflight.current?.promise === promise) inflight.current = null;
    });
    inflight.current = { userId, promise };
    return promise;
  }, []);

  // Reading the stored session can fail (offline refresh): that is "unknown", never "signed out".
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = async (i: number) => {
      let ok = false;
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!error) {
          ok = true;
          if (active) setAuthUserId(data.session?.user.id ?? null);
        }
      } catch {
        // treated as a failed read below
      }
      if (!active) return;
      sessionFailedRef.current = !ok;
      setSessionFailed(!ok);
      if (!ok && i < RETRY_DELAYS_MS.length) {
        timer = setTimeout(() => attempt(i + 1), RETRY_DELAYS_MS[i]);
      }
    };
    void attempt(0);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active' && sessionFailedRef.current) {
        clearTimeout(timer);
        void attempt(RETRY_DELAYS_MS.length);
      }
    });
    let lastUserId: string | null = null;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      // Unsent chat messages belong to one account: forget them on sign-out or when another account signs in.
      // (No Supabase call: the callback runs inside the auth lock, and clearOutbox only touches local storage.)
      const nextUserId = session?.user.id ?? null;
      if (event === 'SIGNED_OUT' || (lastUserId && nextUserId && nextUserId !== lastUserId)) {
        Promise.resolve(clearOutbox()).catch(() => {});
      }
      if (nextUserId || event === 'SIGNED_OUT') lastUserId = nextUserId;
      // Messages queued while signed out (or before a token refresh) can go now.
      if (event === 'SIGNED_IN' && nextUserId) Promise.resolve(flush()).catch(() => {});
      // No Supabase call here: the callback runs inside the auth lock.
      // A null INITIAL_SESSION can mean the stored session could not be refreshed offline: getSession decides.
      if (event === 'INITIAL_SESSION' && !session) return;
      sessionFailedRef.current = false;
      setSessionFailed(false);
      setAuthUserId(session?.user.id ?? null);
    });
    return () => {
      active = false;
      clearTimeout(timer);
      appState.remove();
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
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        sessionFailedRef.current = true;
        setSessionFailed(true);
        return 'loading';
      }
      sessionFailedRef.current = false;
      setSessionFailed(false);
      const id = data.session?.user.id ?? null;
      setAuthUserId(id);
      if (!id) return 'signed_out';
      const l = await loadOnce(id);
      failedRef.current = l.failed;
      setLoaded(l);
      if (l.failed) return 'loading';
      return l.needsProfile ? 'needs_profile' : 'ready';
    } catch {
      sessionFailedRef.current = true;
      setSessionFailed(true);
      return 'loading';
    }
  }, [loadOnce]);

  const value = useMemo<SessionValue>(() => {
    if (authUserId === undefined) {
      return { status: 'loading', userId: null, profile: null, error: sessionFailed, refresh };
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
  }, [authUserId, loaded, refresh, sessionFailed]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  return useContext(SessionContext);
}
