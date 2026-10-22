import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
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
  refresh(): Promise<void>;
}

const SessionContext = createContext<SessionValue>({
  status: 'loading',
  userId: null,
  profile: null,
  refresh: async () => {},
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
  const [tick, setTick] = useState(0);

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
    loadProfile(authUserId).then((l) => active && setLoaded(l));
    return () => {
      active = false;
    };
  }, [authUserId, tick]);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const id = data.session?.user.id ?? null;
    setAuthUserId(id);
    if (id) setLoaded(await loadProfile(id));
    setTick((n) => n + 1);
  }, []);

  const value = useMemo<SessionValue>(() => {
    if (authUserId === undefined) {
      return { status: 'loading', userId: null, profile: null, refresh };
    }
    if (authUserId === null) {
      return { status: 'signed_out', userId: null, profile: null, refresh };
    }
    if (!loaded || loaded.userId !== authUserId || loaded.failed) {
      return { status: 'loading', userId: authUserId, profile: null, refresh };
    }
    return {
      status: loaded.needsProfile ? 'needs_profile' : 'ready',
      userId: authUserId,
      profile: loaded.profile,
      refresh,
    };
  }, [authUserId, loaded, refresh]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  return useContext(SessionContext);
}
