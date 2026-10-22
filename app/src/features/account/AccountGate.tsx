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

  const requireAccount = useCallback<RequireAccount>((r) => {
    if (statusRef.current === 'ready') return Promise.resolve(true);
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
