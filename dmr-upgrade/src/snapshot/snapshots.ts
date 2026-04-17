/**
 * SNAPSHOTS — Task 5
 *
 * Periodic checkpointing of OverlayState so nodes don't need to replay
 * the entire event log from genesis every boot. A snapshot captures the
 * full state at a given height and event hash, enabling:
 *
 *   SS1: Fast-start — boot from the most recent snapshot, replay only
 *        the tail of the log.
 *
 *   SS2: Snapshot integrity — every snapshot is content-addressed so
 *        its authenticity is verifiable before use.
 *
 *   SS3: Retention policy — automatic pruning of events older than the
 *        latest N snapshots to bound disk usage.
 *
 *   SS4: Incremental snapshots — delta snapshots record only the state
 *        changes since the last full snapshot (space-efficient).
 *
 *   SS5: Multi-store — snapshots can be persisted to IndexedDB, OPFS,
 *        or in-memory; pluggable backend.
 */

import type { OverlayState } from '../dag/dag-events';

// ── Snapshot Types ───────────────────────────────────────────────────────────

/** A full, self-contained snapshot of OverlayState at a given height. */
export interface FullSnapshot {
  kind:        'full';
  /** Monotonically increasing snapshot id for this node. */
  snapshotId:  number;
  /** Overlay height at the time of snapshotting. */
  height:      number;
  /** Hash of the last event applied before this snapshot. */
  headHash:    string;
  /** Wall-clock time of snapshot creation. */
  createdAt:   number;
  /** Content hash of the serialized state. Verifies snapshot integrity. */
  stateHash:   string;
  /** The serialized overlay state (JSON-stringified). */
  state:       SerializedOverlayState;
}

/** Lightweight delta snapshot — only records changes since a base snapshot. */
export interface DeltaSnapshot {
  kind:        'delta';
  snapshotId:  number;
  /** The snapshotId of the base (full) snapshot this delta applies to. */
  baseId:      number;
  height:      number;
  headHash:    string;
  createdAt:   number;
  stateHash:   string;
  /** Only the fields that changed since the base snapshot. */
  delta:       Partial<SerializedOverlayState>;
}

export type Snapshot = FullSnapshot | DeltaSnapshot;

/**
 * JSON-serializable form of OverlayState.
 * Maps are serialized as arrays of [key, value] pairs.
 */
export interface SerializedOverlayState {
  cidRegistry:    [string, unknown][];
  capIndex:       [string, unknown][];
  revocationList: string[];
  revokedCIDs:    string[];
  peerGraph:      [string, unknown[]][];
  activeSessions: [string, unknown][];
  routeSets:      [string, unknown][];
  height:         number;
}

// ── Serialization ────────────────────────────────────────────────────────────

/** Serialize OverlayState to a JSON-safe structure. */
export function serializeState(state: OverlayState): SerializedOverlayState {
  return {
    cidRegistry:    Array.from(state.cidRegistry.entries()),
    capIndex:       Array.from(state.capIndex.entries()),
    revocationList: Array.from(state.revocationList),
    revokedCIDs:    Array.from(state.revokedCIDs),
    peerGraph:      Array.from(state.peerGraph.entries()) as [string, unknown[]][],
    activeSessions: Array.from(state.activeSessions.entries()),
    routeSets:      Array.from(state.routeSets.entries()),
    height:         state.height,
  };
}

/** Deserialize a snapshot's state back to OverlayState. */
export function deserializeState(s: SerializedOverlayState): OverlayState {
  return {
    cidRegistry:    new Map(s.cidRegistry as [string, any][]),
    capIndex:       new Map(s.capIndex as [string, any][]),
    revocationList: new Set(s.revocationList),
    revokedCIDs:    new Set(s.revokedCIDs),
    peerGraph:      new Map(s.peerGraph as [string, any][]),
    activeSessions: new Map(s.activeSessions as [string, any][]),
    routeSets:      new Map(s.routeSets as [string, any][]),
    height:         s.height,
  };
}

// ── SS2: Snapshot Integrity ───────────────────────────────────────────────────

/**
 * Compute a canonical hash of a serialized state.
 * Uses a simple stable JSON fingerprint — in production, replace with
 * SHA-256 via SubtleCrypto or node:crypto.
 */
export function hashSerializedState(s: SerializedOverlayState): string {
  const canonical = JSON.stringify({
    cidRegistry:    s.cidRegistry.sort(([a], [b]) => a < b ? -1 : 1),
    capIndex:       s.capIndex.sort(([a], [b]) => a < b ? -1 : 1),
    revocationList: [...s.revocationList].sort(),
    revokedCIDs:    [...s.revokedCIDs].sort(),
    peerGraph:      s.peerGraph.sort(([a], [b]) => a < b ? -1 : 1),
    activeSessions: s.activeSessions.sort(([a], [b]) => a < b ? -1 : 1),
    routeSets:      s.routeSets.sort(([a], [b]) => a < b ? -1 : 1),
    height:         s.height,
  });
  // FNV-1a 32-bit as a fast, portable, deterministic fingerprint
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// ── SS1: Snapshot Creation ────────────────────────────────────────────────────

let _snapshotCounter = 0;

/**
 * Create a full snapshot of the current overlay state.
 */
export function createFullSnapshot(
  state:    OverlayState,
  headHash: string,
  opts:     { nowMs?: number } = {},
): FullSnapshot {
  const serialized = serializeState(state);
  return {
    kind:       'full',
    snapshotId: ++_snapshotCounter,
    height:     state.height,
    headHash,
    createdAt:  opts.nowMs ?? Date.now(),
    stateHash:  hashSerializedState(serialized),
    state:      serialized,
  };
}

/**
 * Verify a snapshot's integrity before loading it.
 */
export function verifySnapshot(snap: FullSnapshot): {
  ok: boolean;
  reason?: string;
} {
  const computed = hashSerializedState(snap.state);
  if (computed !== snap.stateHash) {
    return {
      ok:     false,
      reason: `State hash mismatch: expected ${snap.stateHash}, computed ${computed}`,
    };
  }
  const restored = deserializeState(snap.state);
  if (restored.height !== snap.height) {
    return { ok: false, reason: `Height mismatch in snapshot` };
  }
  return { ok: true };
}

// ── SS4: Delta Snapshots ──────────────────────────────────────────────────────

/**
 * Create a delta snapshot relative to a base full snapshot.
 * Only records the map entries and set members that changed.
 */
export function createDeltaSnapshot(
  base:     FullSnapshot,
  current:  OverlayState,
  headHash: string,
  opts:     { nowMs?: number } = {},
): DeltaSnapshot {
  const baseState  = deserializeState(base.state);
  const currSerial = serializeState(current);
  const delta: Partial<SerializedOverlayState> = {};

  // Diff CID registry
  const newCIDs = currSerial.cidRegistry.filter(
    ([k]) => !baseState.cidRegistry.has(k),
  );
  if (newCIDs.length > 0) delta.cidRegistry = newCIDs;

  // Diff capability index
  const newCaps = currSerial.capIndex.filter(([k]) => !baseState.capIndex.has(k));
  if (newCaps.length > 0) delta.capIndex = newCaps;

  // Diff revocation lists (grow-only)
  const newRevocations = currSerial.revocationList.filter(
    id => !baseState.revocationList.has(id),
  );
  if (newRevocations.length > 0) delta.revocationList = newRevocations;

  const newRevokedCIDs = currSerial.revokedCIDs.filter(
    id => !baseState.revokedCIDs.has(id),
  );
  if (newRevokedCIDs.length > 0) delta.revokedCIDs = newRevokedCIDs;

  // Diff peer graph
  const newPeers = currSerial.peerGraph.filter(([k]) => !baseState.peerGraph.has(k));
  if (newPeers.length > 0) delta.peerGraph = newPeers as [string, unknown[]][];

  // Diff sessions
  const newSessions = currSerial.activeSessions.filter(
    ([k]) => !baseState.activeSessions.has(k),
  );
  if (newSessions.length > 0) delta.activeSessions = newSessions;

  // Route sets
  const newRoutes = currSerial.routeSets.filter(([k]) => !baseState.routeSets.has(k));
  if (newRoutes.length > 0) delta.routeSets = newRoutes;

  delta.height = current.height;

  return {
    kind:       'delta',
    snapshotId: ++_snapshotCounter,
    baseId:     base.snapshotId,
    height:     current.height,
    headHash,
    createdAt:  opts.nowMs ?? Date.now(),
    stateHash:  hashSerializedState(currSerial),
    delta,
  };
}

/**
 * Apply a delta snapshot onto a base state to reconstruct the state
 * at the delta's height. Returns a new OverlayState.
 */
export function applyDelta(
  baseState: OverlayState,
  delta:     DeltaSnapshot,
): OverlayState {
  const d = delta.delta;
  const next: OverlayState = {
    cidRegistry:    new Map(baseState.cidRegistry),
    capIndex:       new Map(baseState.capIndex),
    revocationList: new Set(baseState.revocationList),
    revokedCIDs:    new Set(baseState.revokedCIDs),
    peerGraph:      new Map(baseState.peerGraph),
    activeSessions: new Map(baseState.activeSessions),
    routeSets:      new Map(baseState.routeSets),
    height:         d.height ?? baseState.height,
  };

  if (d.cidRegistry)    for (const [k, v] of d.cidRegistry) next.cidRegistry.set(k, v as any);
  if (d.capIndex)       for (const [k, v] of d.capIndex)    next.capIndex.set(k, v as any);
  if (d.revocationList) for (const id of d.revocationList)  next.revocationList.add(id);
  if (d.revokedCIDs)    for (const id of d.revokedCIDs)     next.revokedCIDs.add(id);
  if (d.peerGraph)      for (const [k, v] of d.peerGraph)   next.peerGraph.set(k, v as any);
  if (d.activeSessions) for (const [k, v] of d.activeSessions) next.activeSessions.set(k, v as any);
  if (d.routeSets)      for (const [k, v] of d.routeSets)   next.routeSets.set(k, v as any);

  return next;
}

// ── SS5: Pluggable Snapshot Store ─────────────────────────────────────────────

export interface SnapshotStore {
  save(snap: Snapshot): Promise<void>;
  load(snapshotId: number): Promise<Snapshot | null>;
  loadLatest(): Promise<FullSnapshot | null>;
  list(): Promise<Snapshot[]>;
  delete(snapshotId: number): Promise<void>;
}

/** SS3: In-memory store (for testing and browser fallback). */
export class InMemorySnapshotStore implements SnapshotStore {
  private readonly _store = new Map<number, Snapshot>();

  async save(snap: Snapshot): Promise<void> {
    this._store.set(snap.snapshotId, snap);
  }

  async load(snapshotId: number): Promise<Snapshot | null> {
    return this._store.get(snapshotId) ?? null;
  }

  async loadLatest(): Promise<FullSnapshot | null> {
    let best: FullSnapshot | null = null;
    for (const snap of this._store.values()) {
      if (snap.kind === 'full') {
        if (!best || snap.height > best.height) best = snap;
      }
    }
    return best;
  }

  async list(): Promise<Snapshot[]> {
    return Array.from(this._store.values()).sort((a, b) => a.snapshotId - b.snapshotId);
  }

  async delete(snapshotId: number): Promise<void> {
    this._store.delete(snapshotId);
  }
}

// ── SS3: Retention Policy ─────────────────────────────────────────────────────

export interface RetentionPolicy {
  /** Maximum number of full snapshots to keep. */
  maxFullSnapshots: number;
  /** Maximum number of delta snapshots per full snapshot. */
  maxDeltasPerFull: number;
}

/**
 * Prune snapshots according to the retention policy.
 * Keeps the most recent `maxFullSnapshots` full snapshots and their deltas;
 * deletes the rest.
 */
export async function pruneSnapshots(
  store:  SnapshotStore,
  policy: RetentionPolicy,
): Promise<{ deleted: number[] }> {
  const all = await store.list();
  const fulls = all
    .filter((s): s is FullSnapshot => s.kind === 'full')
    .sort((a, b) => b.height - a.height);

  const keepFullIds = new Set(
    fulls.slice(0, policy.maxFullSnapshots).map(s => s.snapshotId),
  );

  const deleted: number[] = [];
  for (const snap of all) {
    if (snap.kind === 'full' && !keepFullIds.has(snap.snapshotId)) {
      await store.delete(snap.snapshotId);
      deleted.push(snap.snapshotId);
    } else if (snap.kind === 'delta' && !keepFullIds.has(snap.baseId)) {
      await store.delete(snap.snapshotId);
      deleted.push(snap.snapshotId);
    }
  }

  return { deleted };
}