// ════════════════════════════════════════════════════════════════════════════
//  @i-am-ios/sdk/react  —  React 18 hooks + provider
//
//  import { SovereignProvider, useSovereignLog, useNetworkStatus } from '@i-am-ios/sdk/react'
// ════════════════════════════════════════════════════════════════════════════

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { SovereignLog }  from '../sovereign-log.js';
import { HybridNetwork } from '../hybrid-network.js';
import type {
  SovereignEvent,
  NetworkMode,
  HybridNetworkOptions,
  SovereignLogOptions,
  DeriveStateFn,
} from '../types.js';

// ── Context ───────────────────────────────────────────────────────────────────

interface SovereignCtx {
  log:     SovereignLog;
  network: HybridNetwork;
}

const Ctx = createContext<SovereignCtx | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

interface SovereignProviderProps extends HybridNetworkOptions, SovereignLogOptions {
  children: ReactNode;
}

export function SovereignProvider({ children, ...opts }: SovereignProviderProps) {
  const ref = useRef<SovereignCtx | null>(null);

  if (!ref.current) {
    const log     = new SovereignLog({ nodeId: opts.nodeId ?? 'auto' });
    const network = new HybridNetwork({
      validatorEndpoint: opts.validatorEndpoint,
      validatorBackups:  opts.validatorBackups,
      fallbackTimeout:   opts.fallbackTimeout,
      checkInterval:     opts.checkInterval,
      quorum:            opts.quorum,
    });
    ref.current = { log, network };
  }

  useEffect(() => {
    ref.current!.network.connect();
    return () => ref.current!.network.disconnect();
  }, []);

  return <Ctx.Provider value={ref.current}>{children}</Ctx.Provider>;
}

// ── useSovereignLog ───────────────────────────────────────────────────────────

interface UseSovereignLogReturn {
  /** Emit a new event */
  emit:    <T = unknown>(event: Pick<SovereignEvent<T>, 'type' | 'payload'>) => Promise<SovereignEvent<T>>;
  /** All events in the log (reactive) */
  events:  SovereignEvent[];
  /** Current chain head hash */
  headHash: string;
  /** Total events */
  height:  number;
  /** Raw log instance for advanced use */
  log:     SovereignLog;
}

export function useSovereignLog(): UseSovereignLogReturn {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSovereignLog must be used inside <SovereignProvider>');

  const [events,   setEvents]   = useState<SovereignEvent[]>([]);
  const [headHash, setHeadHash] = useState('00000000');
  const [height,   setHeight]   = useState(0);

  useEffect(() => {
    const off = ctx.log.on('event', () => {
      // Snapshot current events (immutable copy)
      const snap = [...ctx.log.events];
      setEvents(snap);
      setHeadHash(ctx.log.headHash);
      setHeight(ctx.log.height);
    });
    return off;
  }, [ctx.log]);

  const emit = useCallback(
    <T = unknown>(event: Pick<SovereignEvent<T>, 'type' | 'payload'>) => {
      const result = ctx.log.emit<T>(event);
      // Also broadcast to the network
      result.then((e) => ctx.network.broadcast(e as SovereignEvent));
      return result;
    },
    [ctx]
  );

  return { emit, events, headHash, height, log: ctx.log };
}

// ── useNetworkStatus ──────────────────────────────────────────────────────────

interface UseNetworkStatusReturn {
  mode:    NetworkMode;
  network: HybridNetwork;
}

export function useNetworkStatus(): UseNetworkStatusReturn {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useNetworkStatus must be used inside <SovereignProvider>');

  const [mode, setMode] = useState<NetworkMode>(ctx.network.mode);

  useEffect(() => {
    const off = ctx.network.on<NetworkMode>('mode', setMode);
    return off;
  }, [ctx.network]);

  return { mode, network: ctx.network };
}

// ── useDerivedState ───────────────────────────────────────────────────────────

/**
 * Derive and memoize application state from the event log.
 * Re-runs `deriveState` only when new events arrive.
 */
export function useDerivedState<S>(deriveState: DeriveStateFn<S>, initialState: S): S {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDerivedState must be used inside <SovereignProvider>');

  const [state, setState] = useState<S>(initialState);

  useEffect(() => {
    const off = ctx.log.on('event', () => {
      setState(ctx.log.deriveState(deriveState));
    });
    return off;
  }, [ctx.log, deriveState]);

  return state;
}
