import { readable, writable, derived, get } from 'svelte/store';
import { SovereignLog, EVENT_TYPES }         from '../sovereign-log.js';
import { HybridNetwork }                     from '../hybrid-network.js';
import type { HybridNetworkOptions }         from '../types.js';

export function createSovereignLog(opts = {}) {
  const _log = new SovereignLog(opts);

  const { subscribe, set } = writable(_log.deriveState());
  const logStore           = writable(_log.getLog());

  _log.subscribe((state) => {
    set(state);
    logStore.set(_log.getLog());
  });

  function emit(type: string, payload: Record<string, unknown> = {}) {
    return _log.emit(type, payload);
  }

  function reset() {
    const fresh = new SovereignLog(opts);
    set(fresh.deriveState());
    logStore.set([]);
  }

  return {
    subscribe,
    log: { subscribe: logStore.subscribe },
    emit,
    reset,
    snapshot:  () => _log.snapshot(),
    restore:   (saved: any[]) => _log.restore(saved),
  };
}

export async function createHybridNetwork(opts: HybridNetworkOptions = {}) {
  const net     = await HybridNetwork.attach(opts);
  const mode    = writable(net.mode);
  const online  = writable(net.isOnline);

  return {
    broadcast: (record: any) => net.broadcastEvent(record),
    mode:      { subscribe: mode.subscribe },
    online:    { subscribe: online.subscribe },
    destroy:   () => net.destroy(),
  };
}

export { EVENT_TYPES };
