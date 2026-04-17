/**
 * EXECUTION ENGINE — Pure state-transition function.
 *
 * exec(state, event) → state'
 *
 * INVARIANTS (must never be violated):
 *   1. exec is a pure function — no external I/O, no Date.now(), no Math.random()
 *   2. exec never mutates its inputs — always returns a new State
 *   3. Same (state, event) always produces the same state' on any node
 *
 * Extend the switch statement with your application's event types.
 */

import { Event } from '../events/event';
import { State, makeState, applyDataPatch } from '../state/state';

// ── Execution engine ──────────────────────────────────────────────────────────

export class ExecutionEngine {
  /**
   * Apply a single event to the current state.
   * Returns the new state. Never mutates the input state.
   *
   * @throws Error if the event type is unknown (use 'OTHER' as a fallback in your registry)
   */
  exec(state: State, event: Event): State {
    return exec(state, event);
  }
}

/**
 * Pure state-transition function.
 * This is the single canonical execution path.
 *
 * Add your application event types to the switch statement.
 */
export function exec(state: State, event: Event): State {
  // All events increment height and record their id in data
  // Replace these cases with your domain logic.
  switch (event.type) {

    case 'TASK': {
      const payload = event.payload as Record<string, unknown>;
      return applyDataPatch(state, {
        [`task:${payload.id ?? event.id}`]: {
          id:      payload.id ?? event.id,
          name:    payload.name ?? '',
          actor:   event.actor,
          created: event.timestamp,
        },
      });
    }

    case 'TRANSFER': {
      const payload = event.payload as Record<string, unknown>;
      const from    = String(payload.from ?? event.actor);
      const to      = String(payload.to ?? '');
      const amount  = Number(payload.amount ?? 0);

      const fromBal = Number((state.data[`balance:${from}`] as number) ?? 0);
      const toBal   = Number((state.data[`balance:${to}`] as number) ?? 0);

      if (fromBal < amount) {
        throw new Error(`Insufficient balance: ${from} has ${fromBal}, needs ${amount}`);
      }

      return applyDataPatch(state, {
        [`balance:${from}`]: fromBal - amount,
        [`balance:${to}`]:   toBal + amount,
      });
    }

    case 'SET': {
      const payload = event.payload as Record<string, unknown>;
      return applyDataPatch(state, {
        [String(payload.key)]: payload.value,
      });
    }

    case 'DELETE': {
      const payload = event.payload as Record<string, unknown>;
      const newData = { ...state.data };
      delete newData[String(payload.key)];
      return makeState({
        height:  state.height + 1,
        version: state.version,
        data:    newData,
      });
    }

    case 'NOOP': {
      // No-op: state is unchanged structurally, but height increments
      return makeState({
        height:  state.height + 1,
        version: state.version,
        data:    { ...state.data },
      });
    }

    default: {
      // Unknown event type: record it in data but do not throw.
      // This makes the kernel forward-compatible with new event types.
      return applyDataPatch(state, {
        [`event:${event.id}`]: {
          type:      event.type,
          actor:     event.actor,
          timestamp: event.timestamp,
        },
      });
    }
  }
}