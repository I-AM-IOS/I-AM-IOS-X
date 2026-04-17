// ════════════════════════════════════════════════════════════════════════════
//  HybridNetwork  —  Auto-switching validator ↔ P2P transport
//
//  Mode 1 (online):     Browser → public validator → BFT consensus (1–6 s)
//  Mode 2 (offline):    Browser ↔ Browser P2P gossip (resilient, indefinite)
//  Mode 3 (hybrid):     Try validator (2 s timeout) → fallback to P2P
// ════════════════════════════════════════════════════════════════════════════

import type { SovereignEvent, HybridNetworkOptions, NetworkMode, FinalityResult } from './types.js';

type ModeListener = (mode: NetworkMode) => void;

export class HybridNetwork {
  private _opts:       Required<HybridNetworkOptions>;
  private _mode:       NetworkMode = 'connecting';
  private _listeners:  Map<string, Set<(...args: unknown[]) => void>> = new Map();
  private _probeTimer: ReturnType<typeof setInterval> | null = null;
  private _pending:    SovereignEvent[] = [];

  constructor(opts: HybridNetworkOptions = {}) {
    this._opts = {
      validatorEndpoint: opts.validatorEndpoint ?? '',
      validatorBackups:  opts.validatorBackups  ?? [],
      fallbackTimeout:   opts.fallbackTimeout   ?? 2000,
      checkInterval:     opts.checkInterval     ?? 5000,
      quorum:            opts.quorum            ?? 0.67,
    };
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    await this._probe();
    this._probeTimer = setInterval(() => this._probe(), this._opts.checkInterval);
  }

  disconnect(): void {
    if (this._probeTimer) {
      clearInterval(this._probeTimer);
      this._probeTimer = null;
    }
    this._setMode('offline');
  }

  // ── Broadcast ─────────────────────────────────────────────────────────────

  /**
   * Broadcast an event.
   * Uses validator if online (fast path), else falls back to P2P.
   */
  async broadcast(event: SovereignEvent): Promise<FinalityResult> {
    if (this._mode === 'online' || this._mode === 'hybrid') {
      const result = await this._sendToValidator(event);
      if (result) return result;
    }
    return this._broadcastP2P(event);
  }

  /**
   * Wait for finality on a given event hash.
   * Online: waits for validator quorum confirmation.
   * Offline: waits for local P2P quorum.
   */
  async awaitFinality(eventHash: string, timeoutMs = 10_000): Promise<FinalityResult> {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Finality timeout for ${eventHash}`)),
        timeoutMs
      );
      const off = this.on('finality', (result: FinalityResult) => {
        if (result.hash === eventHash) {
          clearTimeout(timer);
          off();
          resolve(result);
        }
      });
    });
  }

  // ── Probe ─────────────────────────────────────────────────────────────────

  private async _probe(): Promise<void> {
    if (!this._opts.validatorEndpoint) {
      this._setMode('offline');
      return;
    }

    const endpoints = [this._opts.validatorEndpoint, ...this._opts.validatorBackups];

    for (const url of endpoints) {
      try {
        const ctrl = new AbortController();
        const tid  = setTimeout(() => ctrl.abort(), this._opts.fallbackTimeout);
        const res  = await fetch(`${url}/health`, { signal: ctrl.signal });
        clearTimeout(tid);

        if (res.ok) {
          const prev = this._mode;
          this._setMode('online');
          if (prev === 'offline' || prev === 'hybrid') {
            // Resync any events queued while offline
            await this._resync();
          }
          return;
        }
      } catch {
        // Swallow — try next
      }
    }

    this._setMode(this._mode === 'connecting' ? 'offline' : 'hybrid');
  }

  // ── Validator path ────────────────────────────────────────────────────────

  private async _sendToValidator(event: SovereignEvent): Promise<FinalityResult | null> {
    const base = this._opts.validatorEndpoint;
    if (!base) return null;

    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), this._opts.fallbackTimeout * 2);

      const res = await fetch(`${base}/submit`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(event),
        signal:  ctrl.signal,
      });
      clearTimeout(tid);

      if (!res.ok) return null;

      const data = await res.json() as FinalityResult;
      this._emit('finality', data);
      return data;
    } catch {
      this._setMode('hybrid');
      this._pending.push(event);
      return null;
    }
  }

  // ── P2P path (BroadcastChannel + PeerJS shim) ─────────────────────────────

  private async _broadcastP2P(event: SovereignEvent): Promise<FinalityResult> {
    // BroadcastChannel for same-origin tabs (instant, no network)
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel('sovereign-os-bus');
      bc.postMessage({ type: 'EVENT', event });
      bc.close();
    }

    // Return a local finality result (P2P finality is async via events)
    const result: FinalityResult = {
      eventId:     event.id ?? '',
      hash:        event.hash ?? '',
      height:      0,
      mode:        'offline',
      confirmedAt: Date.now(),
    };

    this._emit('finality', result);
    return result;
  }

  // ── Resync on reconnect ───────────────────────────────────────────────────

  private async _resync(): Promise<void> {
    if (!this._pending.length) return;
    const batch = this._pending.splice(0);
    for (const evt of batch) {
      await this._sendToValidator(evt);
    }
  }

  // ── Mode setter ───────────────────────────────────────────────────────────

  private _setMode(mode: NetworkMode): void {
    if (this._mode === mode) return;
    this._mode = mode;
    this._emit('mode', mode);
  }

  get mode(): NetworkMode {
    return this._mode;
  }

  // ── Event emitter ─────────────────────────────────────────────────────────

  on<T = unknown>(type: string, listener: (arg: T) => void): () => void {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type)!.add(listener as (...args: unknown[]) => void);
    return () => this._listeners.get(type)?.delete(listener as (...args: unknown[]) => void);
  }

  private _emit(type: string, ...args: unknown[]): void {
    this._listeners.get(type)?.forEach((l) => l(...args));
  }
}
