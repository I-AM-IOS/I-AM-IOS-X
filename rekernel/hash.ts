/**
 * HASH UTILITIES — Canonical, deterministic hashing for the locked kernel.
 *
 * All hash functions used in the kernel are defined here.
 * This is the single source of truth for hashing semantics.
 */

import crypto from 'crypto';

// ── Canonical JSON serialization ──────────────────────────────────────────────

/**
 * Produces a deterministic JSON string by sorting object keys recursively.
 * Ensures that { b:2, a:1 } and { a:1, b:2 } produce the same serialization.
 */
export function canonicalJSON(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']';

  const sorted = Object.keys(value as object)
    .sort()
    .map((k) => JSON.stringify(k) + ':' + canonicalJSON((value as Record<string, unknown>)[k]))
    .join(',');
  return '{' + sorted + '}';
}

// ── Core SHA-256 wrapper ──────────────────────────────────────────────────────

/**
 * SHA-256 hash of a string. Returns hex digest.
 */
export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

// ── Domain-specific hash functions ───────────────────────────────────────────

/**
 * Hash an event from its constituent fields (excluding hash/id fields to avoid circularity).
 */
export function hashEvent(fields: {
  id:        string;
  type:      string;
  actor:     string;
  timestamp: number;
  payload:   unknown;
  prevHash:  string | null;
}): string {
  return sha256(canonicalJSON(fields));
}

/**
 * Hash a state object.
 */
export function hashState(state: { [key: string]: unknown }): string {
  return sha256(canonicalJSON(state));
}

/**
 * Compute a transition hash: T_i = hash(T_{i-1}, E_i.hash, S_i.stateHash)
 */
export function hashTransition(
  prevTransitionHash: string | null,
  eventHash: string,
  postStateHash: string,
): string {
  return sha256(canonicalJSON({ prevTransitionHash, eventHash, postStateHash }));
}

/**
 * Derive a short (32-char) identifier from arbitrary content.
 */
export function deriveId(content: unknown): string {
  return sha256(canonicalJSON(content)).slice(0, 32);
}