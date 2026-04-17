/**
 * PURE REPLAY ENGINE — Task 3
 *
 * A production-grade log replay system that reconstructs overlay state
 * from an ordered sequence of OverlayEvents. Design goals:
 *
 *   RE1: Pure function — no side effects. Same log → same state always.
 *   RE2: Incremental — can resume from a snapshot (see Task 5).
 *   RE3: Verified replay — every event is re-verified before application.
 *   RE4: Streaming — yields progress updates for large logs without blocking.
 *   RE5: Error isolation — bad events are quarantined, not thrown.
 *   RE6: Halt conditions — explicit stop points (height, hash, timestamp).
 *
 * Integrates with:
 *   - OverlayEvent / applyOverlayEvent from dag-events.ts
 *   - verifyOverlayEvent from dag-events.ts
 *   - OverlayState / emptyOverlayState from dag-events.ts
 *   - Snapshot system (Task 5)
 */

import type { OverlayEvent, OverlayState } from '../dag/dag-events';
import { applyOverlayEvent, emptyOverlayState, verifyOverlayEvent } from '../dag/dag-events';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ReplayOptions {
  /**
   * Starting state. If omitted, replay starts from the genesis (empty state).
   * Supply a snapshot (Task 5) to resume from a checkpoint.
   */
  initialState?:  OverlayState;

  /**
   * Starting height. Events with height ≤ startHeight are skipped
   * (already included in initialState from snapshot).
   */
  startHeight?:   number;

  /**
   * Stop replay after reaching this height. Inclusive.
   * Useful for time-travel debugging.
   */
  stopAtHeight?:  number;

  /**
   * Stop replay when this event hash is reached. Inclusive.
   * Allows replaying exactly up to a known finalized point.
   */
  stopAtHash?:    string;

  /**
   * Stop replay at this logical timestamp (HLC-encoded). Inclusive.
   */
  stopAtTimestamp?: number;

  /**
   * When true, re-verify every event's id and hash during replay.
   * Slightly slower but catches tampering. Defaults to true.
   */
  verifyEvents?:  boolean;

  /**
   * Max clock skew allowed during replay (ms). Defaults to 5 min.
   */
  clockSkewMs?:   number;

  /**
   * Called periodically during long replays. May yield control
   * to allow UI updates or async checkpointing.
   */
  onProgress?:    (progress: ReplayProgress) => void;

  /**
   * How often (event count) to call onProgress. Defaults to 100.
   */
  progressInterval?: number;
}

export interface ReplayProgress {
  processed:   number;
  total:       number;
  height:      number;
  skipped:     number;
  quarantined: number;
  pct:         number;      // 0.0 – 1.0
  lastHash:    string | null;
}

export interface QuarantinedEvent {
  event:  OverlayEvent;
  reason: string;
  code:   string;
  index:  number;
}

export interface ReplayResult {
  state:       OverlayState;
  processed:   number;
  skipped:     number;
  quarantined: QuarantinedEvent[];
  stoppedAt:   'end' | 'height' | 'hash' | 'timestamp';
  finalHeight: number;
  finalHash:   string | null;
}

// ── RE1–RE6: Replay Engine ───────────────────────────────────────────────────

/**
 * Replay an ordered event log to produce the final OverlayState.
 *
 * This is the authoritative state reconstruction function. All nodes
 * applying the same log with the same options produce byte-identical
 * state (given determinism hardening from Task 1 is in place).
 */
export function replayLog(
  events:  readonly OverlayEvent[],
  opts:    ReplayOptions = {},
): ReplayResult {
  const {
    initialState      = emptyOverlayState(),
    startHeight       = 0,
    stopAtHeight,
    stopAtHash,
    stopAtTimestamp,
    verifyEvents      = true,
    clockSkewMs       = 5 * 60 * 1000,
    onProgress,
    progressInterval  = 100,
  } = opts;

  let state: OverlayState = initialState;
  let processed       = 0;
  let skipped         = 0;
  const quarantined:    QuarantinedEvent[] = [];
  let stoppedAt:        ReplayResult['stoppedAt'] = 'end';
  let finalHash:        string | null = null;

  const total = events.length;

  for (let i = 0; i < total; i++) {
    const event = events[i];

    // RE2: Skip events already covered by the initial snapshot
    if (state.height >= startHeight && event.hash === undefined) {
      skipped++;
      continue;
    }
    if (state.height < startHeight) {
      // Fast-path: don't verify, just count
      skipped++;
      continue;
    }

    // RE6: Halt conditions
    if (stopAtHeight !== undefined && state.height >= stopAtHeight) {
      stoppedAt = 'height';
      break;
    }
    if (stopAtHash && finalHash === stopAtHash) {
      stoppedAt = 'hash';
      break;
    }
    if (stopAtTimestamp !== undefined && event.timestamp > stopAtTimestamp) {
      stoppedAt = 'timestamp';
      break;
    }

    // RE3: Optional per-event verification
    if (verifyEvents) {
      const vr = verifyOverlayEvent(event, Date.now(), clockSkewMs);
      if (!vr.ok) {
        quarantined.push({ event, reason: vr.reason, code: vr.code, index: i });
        continue;  // RE5: Quarantine bad events, keep going
      }
    }

    // RE1: Pure state transition
    state = applyOverlayEvent(state, event);
    finalHash = event.hash;
    processed++;

    // RE4: Progress reporting
    if (onProgress && processed % progressInterval === 0) {
      onProgress({
        processed,
        total,
        height:      state.height,
        skipped,
        quarantined: quarantined.length,
        pct:         (i + 1) / total,
        lastHash:    finalHash,
      });
    }
  }

  // Final progress callback
  if (onProgress) {
    onProgress({
      processed,
      total,
      height:      state.height,
      skipped,
      quarantined: quarantined.length,
      pct:         1.0,
      lastHash:    finalHash,
    });
  }

  return {
    state,
    processed,
    skipped,
    quarantined,
    stoppedAt,
    finalHeight: state.height,
    finalHash,
  };
}

// ── Async / Streaming Replay ─────────────────────────────────────────────────

/**
 * Async version of replayLog that yields between batches, preventing
 * the event loop from blocking during very large log replays.
 *
 * Uses `setTimeout(0)` yield points every `batchSize` events so the
 * browser/node can process other tasks (UI updates, network I/O).
 */
export async function replayLogAsync(
  events:    readonly OverlayEvent[],
  opts:      ReplayOptions & { batchSize?: number } = {},
): Promise<ReplayResult> {
  const batchSize = opts.batchSize ?? 50;
  const chunks: OverlayEvent[][] = [];
  for (let i = 0; i < events.length; i += batchSize) {
    chunks.push(events.slice(i, i + batchSize) as OverlayEvent[]);
  }

  let accumulated: ReplayResult = {
    state:       opts.initialState ?? emptyOverlayState(),
    processed:   0,
    skipped:     0,
    quarantined: [],
    stoppedAt:   'end',
    finalHeight: (opts.initialState ?? emptyOverlayState()).height,
    finalHash:   null,
  };

  let totalProcessed = 0;
  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    const chunkResult = replayLog(chunk, {
      ...opts,
      initialState: accumulated.state,
    });

    accumulated = {
      state:       chunkResult.state,
      processed:   accumulated.processed + chunkResult.processed,
      skipped:     accumulated.skipped + chunkResult.skipped,
      quarantined: [...accumulated.quarantined, ...chunkResult.quarantined],
      stoppedAt:   chunkResult.stoppedAt,
      finalHeight: chunkResult.finalHeight,
      finalHash:   chunkResult.finalHash ?? accumulated.finalHash,
    };

    totalProcessed += chunk.length;
    if (chunkResult.stoppedAt !== 'end') break;

    // Yield to event loop between chunks
    if (ci < chunks.length - 1) {
      await new Promise<void>(r => setTimeout(r, 0));
    }
  }

  return accumulated;
}

// ── Deterministic State Diff ─────────────────────────────────────────────────

/**
 * Compute a structural diff between two OverlayStates.
 * Useful for debugging replay correctness and syncing partial state.
 */
export function diffStates(
  before: OverlayState,
  after:  OverlayState,
): StateDiff {
  const diff: StateDiff = {
    heightDelta:      after.height - before.height,
    addedCIDs:        [],
    removedCIDs:      [],
    addedCaps:        [],
    revokedCaps:      [],
    newPeers:         [],
    lostPeers:        [],
    addedSessions:    [],
    removedSessions:  [],
    addedRouteSets:   [],
  };

  for (const [cid] of after.cidRegistry) {
    if (!before.cidRegistry.has(cid)) diff.addedCIDs.push(cid);
  }
  for (const [cid] of before.cidRegistry) {
    if (!after.cidRegistry.has(cid)) diff.removedCIDs.push(cid);
  }

  for (const [id] of after.capIndex) {
    if (!before.capIndex.has(id)) diff.addedCaps.push(id);
  }
  for (const id of after.revocationList) {
    if (!before.revocationList.has(id)) diff.revokedCaps.push(id);
  }

  for (const [cid] of after.peerGraph) {
    if (!before.peerGraph.has(cid)) diff.newPeers.push(cid);
  }
  for (const [cid] of before.peerGraph) {
    if (!after.peerGraph.has(cid)) diff.lostPeers.push(cid);
  }

  for (const [id] of after.activeSessions) {
    if (!before.activeSessions.has(id)) diff.addedSessions.push(id);
  }
  for (const [id] of before.activeSessions) {
    if (!after.activeSessions.has(id)) diff.removedSessions.push(id);
  }

  for (const [key] of after.routeSets) {
    if (!before.routeSets.has(key)) diff.addedRouteSets.push(key);
  }

  return diff;
}

export interface StateDiff {
  heightDelta:     number;
  addedCIDs:       string[];
  removedCIDs:     string[];
  addedCaps:       string[];
  revokedCaps:     string[];
  newPeers:        string[];
  lostPeers:       string[];
  addedSessions:   string[];
  removedSessions: string[];
  addedRouteSets:  string[];
}