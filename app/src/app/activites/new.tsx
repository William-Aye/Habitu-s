import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useRequireAccount } from '../../features/account/AccountGate';
import { CreateActivityFlow } from '../../features/activities/CreateActivityFlow';

/** Create an activity. Needs an account: the sign-up sheet opens first, closing it leaves the screen. */
export default function NewActivity() {
  const requireAccount = useRequireAccount();
  const { collectif } = useLocalSearchParams<{ collectif?: string }>();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let active = true;
    requireAccount('create').then((ok) => {
      if (!active) return;
      if (ok) setAllowed(true);
      else if (router.canGoBack()) router.back();
      else router.replace('/');
    });
    return () => {
      active = false;
    };
  }, [requireAccount]);

  return allowed ? <CreateActivityFlow initialCollectifId={collectif} /> : null;
}
