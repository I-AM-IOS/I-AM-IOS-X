/**
 * STATE — Application state type and helpers.
 *
 * State is never stored as a primary artifact.
 * It is always derived by replaying the event log through exec().
 *
 * The stateHash field is a SHA-256 of the full state, used in:
 *   - Transition records (to detect divergence)
 *   - Snapshots (tamper evidence)
 *   - Rejection records (proof of state at rejection time)
 */

import { hashState } from '../hash';

// ── State type ────────────────────────────────────────────────────────────────

/**
 * The application state shape.
 *
 * Extend this interface with your domain-specific fields.
 * stateHash is computed automatically and must NOT be manually set.
 */
export interface State {
  readonly stateHash:  string;           // SHA-256 of all other fields (auto-computed)
  readonly height:     number;           // Number of events applied so far
  readonly version:    number;           // Protocol version that produced this state

  // ── Domain state (extend as needed) ──────────────────────────────────────
  readonly data:       Record<string, unknown>;  // Arbitrary application data
}

// ── Genesis (initial) state ───────────────────────────────────────────────────

function computeStateHash(fields: Omit<State, 'stateHash'>): string {
  return hashState(fields as Record<string, unknown>);
}

const _genesisFields = {
  height:  0,
  version: 1,
  data:    {},
};

export const initialState: State = Object.freeze({
  ..._genesisFields,
  stateHash: computeStateHash(_genesisFields),
}) as State;

// ── State factory ─────────────────────────────────────────────────────────────

/**
 * Produce a new, frozen State with a freshly-computed stateHash.
 * Always use this instead of constructing State objects manually.
 */
export function makeState(fields: Omit<State, 'stateHash'>): State {
  return Object.freeze({
    ...fields,
    stateHash: computeStateHash(fields),
  }) as State;
}

/**
 * Merge a partial data update into an existing state.
 * Increments height and recomputes stateHash.
 */
export function applyDataPatch(
  state: State,
  patch: Record<string, unknown>,
): State {
  return makeState({
    height:  state.height + 1,
    version: state.version,
    data:    { ...state.data, ...patch },
  });
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Type guard: check if a value is a State.
 */
export function isState(value: unknown): value is State {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.stateHash === 'string' &&
    typeof s.height === 'number' &&
    typeof s.version === 'number'
  );
}