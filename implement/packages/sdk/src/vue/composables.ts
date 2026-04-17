import { ref, reactive, onMounted, onUnmounted, type Ref } from 'vue';
import { SovereignLog, EVENT_TYPES } from '../sovereign-log.js';
import { HybridNetwork }             from '../hybrid-network.js';
import type {
  SystemState,
  SovereignEvent,
  HybridNetworkOptions,
} from '../types.js';

export function useSovereignLog(opts = {}) {
  const _log  = new SovereignLog(opts);
  const state = reactive<SystemState>(_log.deriveState() as SystemState);
  const log   = ref<SovereignEvent[]>([]);
  let unsub: (() => void) | null = null;

  onMounted(() => {
    unsub = _log.subscribe((s) => {
      Object.assign(state, s);
      log.value = _log.getLog();
    });
  });

  onUnmounted(() => unsub?.());

  function emit(type: string, payload: Record<string, unknown> = {}) {
    return _log.emit(type, payload);
  }

  function reset() {
    Object.assign(state, new SovereignLog().deriveState());
    log.value = [];
  }

  return { state, log, emit, reset };
}

export function useHybridNetwork(opts: HybridNetworkOptions = {}) {
  const network: Ref<HybridNetwork | null> = ref(null);
  const mode    = ref<string>('p2p');
  const online  = ref(false);

  onMounted(async () => {
    const net = await HybridNetwork.attach(opts);
    network.value = net;
    mode.value    = net.mode;
    online.value  = net.isOnline;
  });

  onUnmounted(() => network.value?.destroy());

  return { network, mode, online };
}

export { EVENT_TYPES };
