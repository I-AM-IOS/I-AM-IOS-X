/**
 * CONFLICT RESOLUTION RULES — Task 4
 *
 * Defines how the overlay handles concurrent, conflicting events
 * that arrive from different nodes. This is the L2 conflict layer.
 *
 * Conflict classes:
 *
 *   CR1: Identity conflicts — two nodes issue CID_CREATED for same key_id.
 *   CR2: Capability conflicts — same CAP issued twice (nonce collision).
 *   CR3: Revocation races — revoke arrives before or concurrent with use.
 *   CR4: Route set conflicts — two nodes compute different routes for
 *        the same (local, target) pair at the same logical time.
 *   CR5: Session conflicts — concurrent SESSION_ESTABLISHED for same peer pair.
 *   CR6: Rotation conflicts — two rotations from the same CID concurrently.
 *
 * Resolution strategy (in priority order):
 *   1. Causal order — if one event happened-before the other (via Lamport
 *      clock), the later one wins.
 *   2. Consensus finality — if either event is in a CONSENSUS_FINALIZED
 *      block, the finalized event wins.
 *   3. Content-addressed tiebreaker — lexicographically smaller event.id
 *      wins. Deterministic, no coordinator needed.
 *   4. Actor priority — if the two actors have different roles (e.g.,
 *      issuer vs subject for CAPs), the higher-privilege actor wins.
 */

import type { OverlayEvent } from '../dag/dag-events';
import { canonicalSort } from '../determinism/logical-clock';

// ── Conflict Detection ────────────────────────────────────────────────────────

export type ConflictClass =
  | 'CR1_IDENTITY'
  | 'CR2_CAPABILITY'
  | 'CR3_REVOCATION_RACE'
  | 'CR4_ROUTE_SET'
  | 'CR5_SESSION'
  | 'CR6_ROTATION';

export interface ConflictPair {
  class:    ConflictClass;
  eventA:   OverlayEvent;
  eventB:   OverlayEvent;
  /** The event that should be applied (winner). */
  winner:   OverlayEvent;
  /** The event that should be discarded (loser). */
  loser:    OverlayEvent;
  /** Human-readable explanation. */
  reason:   string;
}

/**
 * Detect if two events are in conflict (they cannot both be applied
 * to produce a consistent state).
 */
export function detectConflict(
  a: OverlayEvent,
  b: OverlayEvent,
): ConflictClass | null {
  // Same event (content-identical) — not a conflict
  if (a.id === b.id) return null;

  const ap = a.payload as Record<string, unknown>;
  const bp = b.payload as Record<string, unknown>;

  // CR1: Two CID_CREATED events for the same CID
  if (
    a.type === 'overlay.CID_CREATED' &&
    b.type === 'overlay.CID_CREATED' &&
    (ap.record as Record<string, unknown>)?.cid ===
      (bp.record as Record<string, unknown>)?.cid
  ) return 'CR1_IDENTITY';

  // CR2: Two CAP_ISSUED events with same cap id
  if (
    a.type === 'overlay.CAP_ISSUED' &&
    b.type === 'overlay.CAP_ISSUED' &&
    (ap.token as Record<string, unknown>)?.id ===
      (bp.token as Record<string, unknown>)?.id
  ) return 'CR2_CAPABILITY';

  // CR3: CAP_ISSUED and CAP_REVOKED for the same cap id (race)
  const capIssuedRevoked = (x: OverlayEvent, y: OverlayEvent): boolean => {
    const xp = x.payload as Record<string, unknown>;
    const yp = y.payload as Record<string, unknown>;
    return (
      x.type === 'overlay.CAP_ISSUED' &&
      y.type === 'overlay.CAP_REVOKED' &&
      (xp.token as Record<string, unknown>)?.id === yp.capId
    );
  };
  if (capIssuedRevoked(a, b) || capIssuedRevoked(b, a)) return 'CR3_REVOCATION_RACE';

  // CR4: Two ROUTE_SET_COMPUTED for the same (local, target) pair
  if (
    a.type === 'overlay.ROUTE_SET_COMPUTED' &&
    b.type === 'overlay.ROUTE_SET_COMPUTED' &&
    ap.localCID === bp.localCID &&
    ap.targetCID === bp.targetCID
  ) return 'CR4_ROUTE_SET';

  // CR5: Two SESSION_ESTABLISHED for the same peer pair
  if (
    a.type === 'overlay.SESSION_ESTABLISHED' &&
    b.type === 'overlay.SESSION_ESTABLISHED' &&
    ((ap.localCID === bp.localCID && ap.remoteCID === bp.remoteCID) ||
     (ap.localCID === bp.remoteCID && ap.remoteCID === bp.localCID))
  ) return 'CR5_SESSION';

  // CR6: Two CID_ROTATED events from the same old CID
  if (
    a.type === 'overlay.CID_ROTATED' &&
    b.type === 'overlay.CID_ROTATED' &&
    ap.oldCID === bp.oldCID
  ) return 'CR6_ROTATION';

  return null;
}

// ── Resolution Logic ─────────────────────────────────────────────────────────

/**
 * Given two conflicting events, determine which one wins.
 *
 * Rules applied in priority order:
 *   P1: Consensus finality — finalized events always win.
 *   P2: Lamport clock — higher lc wins (happened-after).
 *   P3: Wall-clock (approximate) — higher timestamp wins.
 *   P4: Content tiebreaker — lexicographically smaller event.id wins.
 *       (This is the deterministic, coordinator-free fallback.)
 */
export function resolveConflict(
  a:     OverlayEvent,
  b:     OverlayEvent,
  opts:  {
    /** Set of hashes that have been included in CONSENSUS_FINALIZED blocks. */
    finalizedHashes?: Set<string>;
    /** Lamport clock values (if tracked separately from event timestamp). */
    lcA?: number;
    lcB?: number;
  } = {},
): ConflictPair | null {
  const cls = detectConflict(a, b);
  if (!cls) return null;

  // P1: Consensus finality
  const aFinalized = opts.finalizedHashes?.has(a.hash) ?? false;
  const bFinalized = opts.finalizedHashes?.has(b.hash) ?? false;
  if (aFinalized && !bFinalized) {
    return makeResolution(cls, a, b, 'winner is consensus-finalized');
  }
  if (bFinalized && !aFinalized) {
    return makeResolution(cls, b, a, 'winner is consensus-finalized');
  }

  // P2: Lamport clock (stored in lc field if present, else use timestamp approx)
  const lcA = opts.lcA ?? extractLc(a);
  const lcB = opts.lcB ?? extractLc(b);
  if (lcA !== lcB) {
    // CR3 special case: revocation always wins over issuance (safety)
    if (cls === 'CR3_REVOCATION_RACE') {
      const revoke = a.type === 'overlay.CAP_REVOKED' ? a : b;
      const issue  = a.type === 'overlay.CAP_ISSUED'  ? a : b;
      return makeResolution(cls, revoke, issue, 'revocation wins over issuance (safety-first)');
    }
    const winner = lcA > lcB ? a : b;
    const loser  = lcA > lcB ? b : a;
    return makeResolution(cls, winner, loser, `higher Lamport clock (${Math.max(lcA, lcB)}) wins`);
  }

  // P3: Wall-clock timestamp (approximate ordering)
  if (a.timestamp !== b.timestamp) {
    const winner = a.timestamp > b.timestamp ? a : b;
    const loser  = a.timestamp > b.timestamp ? b : a;
    return makeResolution(cls, winner, loser, `higher wall-clock timestamp wins`);
  }

  // P4: Deterministic content tiebreaker
  // CR3: Revocation always wins regardless
  if (cls === 'CR3_REVOCATION_RACE') {
    const revoke = a.type === 'overlay.CAP_REVOKED' ? a : b;
    const issue  = a.type === 'overlay.CAP_ISSUED'  ? a : b;
    return makeResolution(cls, revoke, issue, 'revocation wins (safety-first tiebreaker)');
  }

  const sorted = canonicalSort([a.id, b.id]);
  const winner = sorted[0] === a.id ? a : b;
  const loser  = sorted[0] === a.id ? b : a;
  return makeResolution(cls, winner, loser, `deterministic id tiebreaker (smaller id wins)`);
}

function makeResolution(
  cls:    ConflictClass,
  winner: OverlayEvent,
  loser:  OverlayEvent,
  reason: string,
): ConflictPair {
  return { class: cls, eventA: winner, eventB: loser, winner, loser, reason };
}

function extractLc(e: OverlayEvent): number {
  // If the event has an `lc` extension field (added by Task 1 hardening)
  const ext = e as OverlayEvent & { lc?: number };
  return ext.lc ?? 0;
}

// ── Batch Resolution ─────────────────────────────────────────────────────────

/**
 * Given a set of events from different nodes (e.g., received via gossip),
 * detect all conflicts and return a clean, deduplicated, ordered event list.
 *
 * Algorithm:
 *   1. Detect all conflicting pairs.
 *   2. For each conflicting pair, remove the loser.
 *   3. Sort remaining events by (lc, timestamp, id) for canonical ordering.
 */
export function resolveEventBatch(
  events: readonly OverlayEvent[],
  opts: {
    finalizedHashes?: Set<string>;
    lcMap?: Map<string, number>;  // eventId → Lamport clock
  } = {},
): {
  events:     OverlayEvent[];
  conflicts:  ConflictPair[];
} {
  const losers   = new Set<string>();
  const conflicts: ConflictPair[] = [];

  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const pair = resolveConflict(events[i], events[j], {
        finalizedHashes: opts.finalizedHashes,
        lcA: opts.lcMap?.get(events[i].id),
        lcB: opts.lcMap?.get(events[j].id),
      });
      if (pair) {
        conflicts.push(pair);
        losers.add(pair.loser.id);
      }
    }
  }

  const clean = events
    .filter(e => !losers.has(e.id))
    .sort((a, b) => {
      const la = opts.lcMap?.get(a.id) ?? 0;
      const lb = opts.lcMap?.get(b.id) ?? 0;
      if (la !== lb) return la - lb;
      if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
      return a.id < b.id ? -1 : 1;
    });

  return { events: clean, conflicts };
}

// ── CRDT Helpers ─────────────────────────────────────────────────────────────

/**
 * Last-Write-Wins register for a single value.
 * Used for peer endpoint maps, route sets, and session states.
 * The "write" with the highest (lc, id) value wins.
 */
export class LWWRegister<T> {
  private _value: T | null = null;
  private _lc:    number   = -1;
  private _id:    string   = '';

  set(value: T, lc: number, eventId: string): boolean {
    if (lc > this._lc || (lc === this._lc && eventId < this._id)) {
      this._value = value;
      this._lc    = lc;
      this._id    = eventId;
      return true;   // updated
    }
    return false;    // existing value wins
  }

  get value(): T | null { return this._value; }
  get lc():    number   { return this._lc; }
}

/**
 * Grow-only set (G-Set). Values can be added but never removed.
 * Used for revocation lists — once revoked, always revoked.
 */
export class GrowOnlySet<T> {
  private readonly _set: Set<T> = new Set();

  add(value: T): void { this._set.add(value); }
  has(value: T): boolean { return this._set.has(value); }
  size(): number { return this._set.size; }

  merge(other: GrowOnlySet<T>): void {
    for (const v of other._set) this._set.add(v);
  }

  toArray(): T[] { return Array.from(this._set); }
}