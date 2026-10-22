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
import { SignUpSheet } from './SignUpSheet';
import { useSession } from './useSession';

export type GateReason = 'join' | 'message' | 'create' | 'wait' | 'category';

type RequireAccount = (reason: GateReason) => Promise<boolean>;

/** How long a pending session may delay the decision to open the sheet. */
const LOADING_WAIT_MS = 5000;

const GateContext = createContext<RequireAccount>(async () => false);

export function AccountGateProvider({
  children,
  onSignedUp,
}: {
  children: ReactNode;
  /** Runs once the user is signed in with a complete profile (Task 4 merges local interests here). */
  onSignedUp?: (userId: string) => Promise<void>;
}) {
  const { status } = useSession();
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const [reason, setReason] = useState<GateReason | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const requireAccount = useCallback<RequireAccount>(async (r) => {
    // A session still loading may turn out to be ready: wait for it (bounded) before asking.
    const deadline = Date.now() + LOADING_WAIT_MS;
    while (statusRef.current === 'loading' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (statusRef.current === 'ready') return true;
    resolver.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setReason(r);
    });
  }, []);

  const finish = useCallback((ok: boolean) => {
    const resolve = resolver.current;
    resolver.current = null;
    setReason(null);
    resolve?.(ok);
  }, []);

  const value = useMemo(() => requireAccount, [requireAccount]);

  return (
    <GateContext.Provider value={value}>
      {children}
      {reason ? <SignUpSheet reason={reason} onClose={finish} onSignedUp={onSignedUp} /> : null}
    </GateContext.Provider>
  );
}

export function useRequireAccount(): RequireAccount {
  return useContext(GateContext);
}
