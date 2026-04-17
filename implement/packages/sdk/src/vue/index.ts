// ════════════════════════════════════════════════════════════════════════════
//  @i-am-ios/sdk/vue  —  Vue 3 composables + plugin
//
//  import { sovereignPlugin, useSovereignLog, useNetworkStatus } from '@i-am-ios/sdk/vue'
// ════════════════════════════════════════════════════════════════════════════

import { ref, readonly, inject, type App, type InjectionKey } from 'vue';
import { SovereignLog }  from '../sovereign-log.js';
import { HybridNetwork } from '../hybrid-network.js';
import type {
  SovereignEvent,
  NetworkMode,
  HybridNetworkOptions,
  SovereignLogOptions,
  DeriveStateFn,
} from '../types.js';

// ── Injection key ─────────────────────────────────────────────────────────────

interface SovereignCtx {
  log:     SovereignLog;
  network: HybridNetwork;
}

const SOVEREIGN_KEY: InjectionKey<SovereignCtx> = Symbol('sovereign');

// ── Plugin ────────────────────────────────────────────────────────────────────

interface SovereignPluginOptions extends HybridNetworkOptions, SovereignLogOptions {}

export const sovereignPlugin = {
  install(app: App, opts: SovereignPluginOptions = {}) {
    const log     = new SovereignLog({ nodeId: opts.nodeId ?? 'auto' });
    const network = new HybridNetwork(opts);

    network.connect();

    app.provide(SOVEREIGN_KEY, { log, network });
    app.onUnmount?.(() => network.disconnect());
  },
};

// ── useSovereignLog ───────────────────────────────────────────────────────────

export function useSovereignLog() {
  const ctx = inject(SOVEREIGN_KEY);
  if (!ctx) throw new Error('useSovereignLog: missing sovereignPlugin — call app.use(sovereignPlugin)');

  const events   = ref<SovereignEvent[]>([]);
  const headHash = ref('00000000');
  const height   = ref(0);

  ctx.log.on('event', () => {
    events.value   = [...ctx.log.events];
    headHash.value = ctx.log.headHash;
    height.value   = ctx.log.height;
  });

  async function emit<T = unknown>(event: Pick<SovereignEvent<T>, 'type' | 'payload'>) {
    const result = await ctx.log.emit<T>(event);
    ctx.network.broadcast(result as SovereignEvent);
    return result;
  }

  return {
    emit,
    events:   readonly(events),
    headHash: readonly(headHash),
    height:   readonly(height),
    log:      ctx.log,
  };
}

// ── useNetworkStatus ──────────────────────────────────────────────────────────

export function useNetworkStatus() {
  const ctx = inject(SOVEREIGN_KEY);
  if (!ctx) throw new Error('useNetworkStatus: missing sovereignPlugin');

  const mode = ref<NetworkMode>(ctx.network.mode);
  ctx.network.on<NetworkMode>('mode', (m) => { mode.value = m; });

  return { mode: readonly(mode), network: ctx.network };
}

// ── useDerivedState ───────────────────────────────────────────────────────────

export function useDerivedState<S>(deriveState: DeriveStateFn<S>, initialState: S) {
  const ctx = inject(SOVEREIGN_KEY);
  if (!ctx) throw new Error('useDerivedState: missing sovereignPlugin');

  const state = ref<S>(initialState);
  ctx.log.on('event', () => {
    state.value = ctx.log.deriveState(deriveState);
  });

  return readonly(state);
}
