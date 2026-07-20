import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { setNavigationLocked } from './navigationGuard';

export type DeploymentActivityLease = symbol;

interface DeploymentActivityContextValue {
  active: boolean;
  acquire: () => DeploymentActivityLease;
  release: (lease: DeploymentActivityLease) => void;
}

const DeploymentActivityContext = createContext<DeploymentActivityContextValue | null>(null);

export function DeploymentActivityProvider({ children }: { children: ReactNode }) {
  const leasesRef = useRef(new Set<DeploymentActivityLease>());
  const mountedRef = useRef(true);
  const [activeCount, setActiveCount] = useState(0);

  const syncActivity = useCallback(() => {
    const nextCount = leasesRef.current.size;
    setNavigationLocked(nextCount > 0);
    if (mountedRef.current) {
      setActiveCount(nextCount);
    }
  }, []);

  const acquire = useCallback(() => {
    const lease = Symbol('deployment-activity');
    leasesRef.current.add(lease);
    syncActivity();
    return lease;
  }, [syncActivity]);

  const release = useCallback(
    (lease: DeploymentActivityLease) => {
      if (!leasesRef.current.delete(lease)) {
        return;
      }
      syncActivity();
    },
    [syncActivity],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      leasesRef.current.clear();
      setNavigationLocked(false);
    };
  }, []);

  const value = useMemo(
    () => ({ active: activeCount > 0, acquire, release }),
    [acquire, activeCount, release],
  );

  return (
    <DeploymentActivityContext.Provider value={value}>
      {children}
    </DeploymentActivityContext.Provider>
  );
}

export function useDeploymentActivity() {
  const value = useContext(DeploymentActivityContext);
  if (!value) {
    throw new Error('useDeploymentActivity must be used within DeploymentActivityProvider');
  }
  return value;
}
