import { useState, useEffect, useRef, useCallback } from 'react';
import { SovereignLog, EVENT_TYPES }                from '../sovereign-log.js';
import { HybridNetwork }                            from '../hybrid-network.js';
import type {
  SystemState,
  SovereignEvent,
  HybridNetworkOptions,
  UseSovereignLogReturn,
} from '../types.js';

// ── useSovereignLog ───────────────────────────────────────────────────────────
export function useSovereignLog(opts = {}): UseSovereignLogReturn {
  const logRef = useRef<SovereignLog>(new SovereignLog(opts));
  const [state, setState] = useState<SystemState>(() => logRef.current.deriveState());
  const [log, setLog]     = useState<SovereignEvent[]>([]);

  useEffect(() => {
    const unsub = logRef.current.subscribe((s, _rec) => {
      setState(s);
      setLog(logRef.current.getLog());
    });
    return unsub;
  }, []);

  const emit = useCallback(
    (type: string, payload: Record<string, unknown> = {}) => logRef.current.emit(type, payload),
    []
  );

  const reset = useCallback(() => {
    logRef.current = new SovereignLog();
    setState(logRef.current.deriveState());
    setLog([]);
  }, []);

  return { state, log, emit, reset };
}

// ── useHybridNetwork ──────────────────────────────────────────────────────────
export function useHybridNetwork(opts: HybridNetworkOptions = {}) {
  const [network, setNetwork] = useState<HybridNetwork | null>(null);
  const [mode, setMode]       = useState<string>('p2p');
  const [online, setOnline]   = useState(false);

  useEffect(() => {
    let net: HybridNetwork;
    HybridNetwork.attach(opts).then(n => {
      net = n;
      setNetwork(n);
      setMode(n.mode);
      setOnline(n.isOnline);
    });
    return () => net?.destroy();
  }, [opts.validatorEndpoint]);

  return { network, mode, online };
}

// ── SovereignProvider ─────────────────────────────────────────────────────────
import { createContext, useContext, type ReactNode } from 'react';

interface SovereignContextValue extends UseSovereignLogReturn {
  network: HybridNetwork | null;
}

const SovereignContext = createContext<SovereignContextValue | null>(null);

export function SovereignProvider({
  children,
  networkOptions = {},
}: {
  children:       ReactNode;
  networkOptions?: HybridNetworkOptions;
}) {
  const log     = useSovereignLog();
  const { network } = useHybridNetwork(networkOptions);
  return (
    <SovereignContext.Provider value={{ ...log, network }}>
      {children}
    </SovereignContext.Provider>
  );
}

export function useSovereign(): SovereignContextValue {
  const ctx = useContext(SovereignContext);
  if (!ctx) throw new Error('useSovereign must be used inside <SovereignProvider>');
  return ctx;
}

export { EVENT_TYPES };
