import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useSession } from '../account/useSession';

export type AdminRole = 'loading' | 'admin' | 'other';

/**
 * Whether the signed-in person has the admin role. This only decides whether to show the area; the
 * server still refuses every admin call without a second-factor session.
 */
export function useAdminRole(): AdminRole {
  const { status, userId } = useSession();
  const [fetched, setFetched] = useState<{ userId: string; role: AdminRole } | null>(null);

  useEffect(() => {
    if (status !== 'ready' || !userId) return;
    let active = true;
    supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (active) setFetched({ userId, role: !error && data?.role === 'admin' ? 'admin' : 'other' });
      })
      .then(undefined, () => active && setFetched({ userId, role: 'other' }));
    return () => {
      active = false;
    };
  }, [status, userId]);

  if (status === 'loading') return 'loading';
  if (status !== 'ready' || !userId) return 'other';
  return fetched?.userId === userId ? fetched.role : 'loading';
}
