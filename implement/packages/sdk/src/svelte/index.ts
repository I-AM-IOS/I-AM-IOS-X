// ════════════════════════════════════════════════════════════════════════════
//  @i-am-ios/sdk/svelte  —  Svelte 4 stores + config
//
//  import { configureSovereign, sovereignLog, networkStatus } from '@i-am-ios/sdk/svelte'
// ════════════════════════════════════════════════════════════════════════════

import { writable, readonly, derived, get } from 'svelte/store';
import { SovereignLog }  from '../sovereign-log.js';
import { HybridNetwork } from '../hybrid-network.js';
import type {
  SovereignEvent,
  NetworkMode,
  HybridNetworkOptions,
  SovereignLogOptions,
  DeriveStateFn,
} from '../types.js';

// ── Singleton ─────────────────────────────────────────────────────────────────

let _log:     SovereignLog  | null = null;
let _network: HybridNetwork | null = null;

function getCtx(): { log: SovereignLog; network: HybridNetwork } {
  if (!_log || !_network) {
    throw new Error(
      'I-AM-IOS: call configureSovereign() before using stores.\n' +
      '  import { configureSovereign } from "@i-am-ios/sdk/svelte";\n' +
      '  configureSovereign({ validatorEndpoint: "..." });'
    );
  }
  return { log: _log, network: _network };
}

// ── Configure ─────────────────────────────────────────────────────────────────

interface ConfigureOptions extends HybridNetworkOptions, SovereignLogOptions {}

export function configureSovereign(opts: ConfigureOptions = {}) {
  _log     = new SovereignLog({ nodeId: opts.nodeId ?? 'auto' });
  _network = new HybridNetwork(opts);
  _network.connect();
}

export function destroySovereign() {
  _network?.disconnect();
  _log     = null;
  _network = null;
}

// ── sovereignLog store factory ────────────────────────────────────────────────

export function sovereignLog() {
  const ctx       = getCtx();
  const _events   = writable<SovereignEvent[]>([]);
  const _headHash = writable('00000000');
  const _height   = writable(0);

  ctx.log.on('event', () => {
    _events.set([...ctx.log.events]);
    _headHash.set(ctx.log.headHash);
    _height.set(ctx.log.height);
  });

  async function emit<T = unknown>(event: Pick<SovereignEvent<T>, 'type' | 'payload'>) {
    const result = await ctx.log.emit<T>(event);
    ctx.network.broadcast(result as SovereignEvent);
    return result;
  }

  return {
    emit,
    events:   readonly(_events),
    headHash: readonly(_headHash),
    height:   readonly(_height),
    log:      ctx.log,
  };
}

// ── networkStatus store factory ───────────────────────────────────────────────

export function networkStatus() {
  const ctx   = getCtx();
  const _mode = writable<NetworkMode>(ctx.network.mode);

  ctx.network.on<NetworkMode>('mode', (m) => _mode.set(m));

  return {
    mode:    readonly(_mode),
    network: ctx.network,
  };
}

// ── derivedState store factory ────────────────────────────────────────────────

export function derivedState<S>(fn: DeriveStateFn<S>, initialState: S) {
  const ctx    = getCtx();
  const _state = writable<S>(initialState);

  ctx.log.on('event', () => {
    _state.set(ctx.log.deriveState(fn));
  });

  return readonly(_state);
}
