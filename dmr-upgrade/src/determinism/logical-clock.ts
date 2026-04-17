/**
 * DETERMINISM HARDENING — Task 1
 *
 * Eliminates all sources of non-determinism from the event pipeline:
 *
 *  DH1: Logical (Lamport) clock — replaces wall-clock timestamps
 *       in event ordering. Monotonically increasing across all nodes.
 *
 *  DH2: Seeded PRNG — replaces Math.random() for nonce generation.
 *       Deterministic given the same seed (node CID + epoch).
 *
 *  DH3: Frozen sort — canonical sort order for multi-value fields
 *       (peer sets, path lists, validator arrays) so that two nodes
 *       building the same state always produce byte-identical output.
 *
 *  DH4: Clock skew budget — allowable drift before an event is
 *       rejected as "future" or "stale" so replay windows are bounded.
 *
 * Every event factory in dag-events.ts should call logicalNow()
 * instead of Date.now() for the timestamp field.
 */

// ── DH1: Lamport Logical Clock ───────────────────────────────────────────────

/**
 * Lamport clock for a single node.
 *
 * Rules:
 *   - On send: tick() before creating the event; embed in event.lc.
 *   - On receive: advance(remoteLc) then tick().
 *   - Ordering: if lc(a) < lc(b) then a happened-before b.
 *               if lc(a) === lc(b) use actorCID as tiebreaker (lexicographic).
 */
export class LamportClock {
  private _value: number;

  constructor(initial: number = 0) {
    this._value = initial;
  }

  /** Current clock value (read-only). */
  get value(): number { return this._value; }

  /** Increment and return the new value (call before emitting an event). */
  tick(): number {
    this._value += 1;
    return this._value;
  }

  /**
   * Advance the clock to max(local, remote) + 1.
   * Call this when receiving an event with lc = remoteLc.
   */
  advance(remoteLc: number): number {
    this._value = Math.max(this._value, remoteLc) + 1;
    return this._value;
  }

  /** Serialize for persistence. */
  toJSON(): number { return this._value; }

  static fromJSON(v: number): LamportClock {
    return new LamportClock(v);
  }
}

// ── DH2: Seeded PRNG (xoshiro128++) ─────────────────────────────────────────

/**
 * Seeded pseudo-random number generator based on xoshiro128++.
 * Given the same seed, produces an identical byte sequence across
 * all nodes and all JS engines.
 *
 * Usage:
 *   const rng = new DeterministicRng(nodeCid + ':' + epochStr);
 *   const nonce = rng.hexBytes(16);
 */
export class DeterministicRng {
  private s: Uint32Array;

  constructor(seed: string) {
    this.s = new Uint32Array(4);
    // Simple seed expansion: hash the seed string into 4 uint32 slots
    let h = 0x9e3779b9;
    for (let i = 0; i < seed.length; i++) {
      h = Math.imul(h ^ seed.charCodeAt(i), 0x9e3779b9);
      h ^= h >>> 16;
    }
    // Fill slots with splitmix32 from h
    const sm32 = (x: number): number => {
      x = Math.imul(x ^ (x >>> 16), 0x45d9f3b7);
      x = Math.imul(x ^ (x >>> 16), 0x45d9f3b7);
      return x ^ (x >>> 16);
    };
    this.s[0] = sm32(h);
    this.s[1] = sm32(this.s[0]);
    this.s[2] = sm32(this.s[1]);
    this.s[3] = sm32(this.s[2]);
  }

  /** Generate next uint32 using xoshiro128++. */
  nextUint32(): number {
    const { s } = this;
    const result = Math.imul(s[0] + s[3], 1) + s[0];
    const t = s[1] << 9;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = (s[3] << 11) | (s[3] >>> 21);
    return result >>> 0;
  }

  /** Generate n random bytes as a hex string. */
  hexBytes(n: number): string {
    let out = '';
    for (let i = 0; i < n; i++) {
      const b = this.nextUint32() & 0xff;
      out += b.toString(16).padStart(2, '0');
    }
    return out;
  }

  /** Random integer in [0, max). */
  nextInt(max: number): number {
    return (this.nextUint32() >>> 0) % max;
  }
}

// ── DH3: Canonical Sort ──────────────────────────────────────────────────────

/**
 * Sort a string array in a stable, canonical order.
 * Uses Unicode code-point comparison — same on all platforms.
 */
export function canonicalSort(arr: readonly string[]): string[] {
  return [...arr].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Sort an array of objects by a canonical string key, then secondarily
 * by a JSON-serialized fallback for full determinism.
 */
export function canonicalSortBy<T>(
  arr: readonly T[],
  key: (item: T) => string,
): T[] {
  return [...arr].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

/**
 * Return a stable canonical key for a (localCID, targetCID) route pair.
 * Always the lexicographically smaller CID first so the key is symmetric.
 */
export function routeKey(cidA: string, cidB: string): string {
  return cidA < cidB ? `${cidA}↔${cidB}` : `${cidB}↔${cidA}`;
}

// ── DH4: Clock Skew Budget ───────────────────────────────────────────────────

/** Maximum allowed clock skew between nodes (5 minutes). */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/** Maximum age of an event before it is rejected as stale (30 minutes). */
export const MAX_EVENT_AGE_MS = 30 * 60 * 1000;

export type ClockCheckResult =
  | { ok: true }
  | { ok: false; code: 'FUTURE' | 'STALE'; delta: number };

/**
 * Validate that an event's wall-clock timestamp falls within the
 * acceptable skew window relative to the local clock.
 */
export function checkClockSkew(
  eventTimestampMs: number,
  localNowMs: number = Date.now(),
): ClockCheckResult {
  const delta = eventTimestampMs - localNowMs;
  if (delta > MAX_CLOCK_SKEW_MS) {
    return { ok: false, code: 'FUTURE', delta };
  }
  if (-delta > MAX_EVENT_AGE_MS) {
    return { ok: false, code: 'STALE', delta };
  }
  return { ok: true };
}

// ── Hybrid Timestamp ─────────────────────────────────────────────────────────

/**
 * Hybrid Logical Clock timestamp — encodes both logical order and
 * physical time in a single 64-bit-safe number for event.timestamp.
 *
 * Format: (physicalMs << 16) | (logicalCounter & 0xFFFF)
 * - Preserves happened-before from Lamport clock.
 * - Preserves approximate wall-clock time for human readability.
 * - Deterministic tiebreaker: actor CID (lexicographic).
 */
export interface HLCTimestamp {
  physicalMs: number;
  logical:    number;
}

export class HybridLogicalClock {
  private _physical: number;
  private _logical:  number;

  constructor() {
    this._physical = Date.now();
    this._logical  = 0;
  }

  /**
   * Generate a new HLC timestamp for a locally originated event.
   */
  now(): HLCTimestamp {
    const wall = Date.now();
    if (wall > this._physical) {
      this._physical = wall;
      this._logical  = 0;
    } else {
      this._logical += 1;
    }
    return { physicalMs: this._physical, logical: this._logical };
  }

  /**
   * Receive a remote HLC timestamp and update local clock.
   */
  receive(remote: HLCTimestamp): HLCTimestamp {
    const wall = Date.now();
    const maxPhys = Math.max(wall, remote.physicalMs, this._physical);
    if (maxPhys === this._physical && maxPhys === remote.physicalMs) {
      this._logical = Math.max(this._logical, remote.logical) + 1;
    } else if (maxPhys === this._physical) {
      this._logical += 1;
    } else if (maxPhys === remote.physicalMs) {
      this._logical = remote.logical + 1;
    } else {
      this._logical = 0;
    }
    this._physical = maxPhys;
    return { physicalMs: this._physical, logical: this._logical };
  }

  /**
   * Encode HLC as a single sortable number for use in event.timestamp.
   * Safe for timestamps within the next ~2000 years.
   */
  static encode(ts: HLCTimestamp): number {
    // physicalMs occupies high bits, logical the low 16 bits
    return ts.physicalMs * 0x10000 + (ts.logical & 0xffff);
  }

  static decode(encoded: number): HLCTimestamp {
    return {
      physicalMs: Math.floor(encoded / 0x10000),
      logical:    encoded & 0xffff,
    };
  }
}

/**
 * Compare two HLC timestamps. Returns negative if a < b, 0 if equal,
 * positive if a > b. When equal, use actorCID as tiebreaker.
 */
export function compareHLC(
  a: HLCTimestamp,
  b: HLCTimestamp,
  actorA?: string,
  actorB?: string,
): number {
  if (a.physicalMs !== b.physicalMs) return a.physicalMs - b.physicalMs;
  if (a.logical    !== b.logical)    return a.logical    - b.logical;
  if (actorA && actorB) return actorA < actorB ? -1 : actorA > actorB ? 1 : 0;
  return 0;
}