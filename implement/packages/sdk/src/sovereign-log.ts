// ════════════════════════════════════════════════════════════════════════════
//  SovereignLog  —  Deterministic local truth engine
//
//  Invariant: VM_stateₙ = deriveState(eventLog[0..n])
//  Every event is chained: hash(T_i) = FNV32(T_{i-1}.hash + type + payload)
// ════════════════════════════════════════════════════════════════════════════

import type {
  SovereignEvent,
  SovereignLogOptions,
  DeriveStateFn,
  FinalityResult,
  NetworkMode,
} from './types.js';

// ── FNV-32 hash (no deps) ─────────────────────────────────────────────────────

function fnv32(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function makeId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ── SovereignLog ──────────────────────────────────────────────────────────────

export class SovereignLog {
  readonly nodeId:    string;
  private _events:    SovereignEvent[] = [];
  private _listeners: Map<string, Set<(e: SovereignEvent) => void>> = new Map();
  private _opts:      Required<SovereignLogOptions>;

  constructor(opts: SovereignLogOptions = {}) {
    this._opts = {
      nodeId:          opts.nodeId === 'auto' ? makeId() : (opts.nodeId ?? makeId()),
      persist:         opts.persist ?? (typeof indexedDB !== 'undefined'),
      maxEvents:       opts.maxEvents ?? 1000,
      protocolVersion: opts.protocolVersion ?? 1,
    };
    this.nodeId = this._opts.nodeId;
  }

  // ── Core API ───────────────────────────────────────────────────────────────

  /**
   * Append an event to the log and notify listeners.
   * Returns the finalized event with id, hash, and timestamp.
   */
  async emit<T = unknown>(event: Pick<SovereignEvent<T>, 'type' | 'payload'>): Promise<SovereignEvent<T>> {
    const prev    = this._events[this._events.length - 1];
    const prevHash = prev?.hash ?? '00000000';
    const id       = makeId();
    const timestamp = Date.now();
    const hash     = fnv32(prevHash + event.type + JSON.stringify(event.payload ?? {}));

    const finalized: SovereignEvent<T> = {
      ...event,
      id,
      timestamp,
      nodeId:  this.nodeId,
      hash,
      prevHash,
      version: this._opts.protocolVersion,
    };

    this._events.push(finalized as SovereignEvent);
    if (this._events.length > this._opts.maxEvents) {
      this._events.shift();
    }

    // Notify 'event' listeners and type-specific listeners
    this._emit('event', finalized as SovereignEvent);
    this._emit(event.type, finalized as SovereignEvent);

    return finalized;
  }

  /**
   * Derive current application state from the full event log.
   * Pure function — same events always produce the same state.
   */
  deriveState<S>(fn: DeriveStateFn<S>): S {
    return fn(this._events);
  }

  /** Full event log (readonly snapshot) */
  get events(): readonly SovereignEvent[] {
    return this._events;
  }

  /** Current chain head hash */
  get headHash(): string {
    return this._events[this._events.length - 1]?.hash ?? '00000000';
  }

  /** Total events in log */
  get height(): number {
    return this._events.length;
  }

  // ── Ingestion (from network) ───────────────────────────────────────────────

  /**
   * Ingest an event received from the network.
   * Verifies hash chain integrity and rejects invalid events.
   */
  ingest(event: SovereignEvent): boolean {
    const prev     = this._events[this._events.length - 1];
    const prevHash = prev?.hash ?? '00000000';

    // Verify hash chain
    const expected = fnv32(prevHash + event.type + JSON.stringify(event.payload ?? {}));
    if (event.hash && event.hash !== expected) {
      this._emit('rejected', event);
      return false;
    }

    this._events.push(event);
    this._emit('event', event);
    this._emit(event.type, event);
    return true;
  }

  // ── Event emitter ──────────────────────────────────────────────────────────

  on(type: string, listener: (e: SovereignEvent) => void): () => void {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type)!.add(listener);
    return () => this._listeners.get(type)?.delete(listener);
  }

  private _emit(type: string, event: SovereignEvent) {
    this._listeners.get(type)?.forEach((l) => l(event));
  }
}
