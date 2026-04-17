/**
 * EVENT — Core event type and factory functions.
 *
 * An Event is the atomic unit of the system.
 * Events are immutable once created (Object.freeze).
 * State is never stored directly; it is always derived by replaying events.
 */

import crypto from 'crypto';
import { hashEvent, canonicalJSON, sha256 } from '../hash';
import { HASH_PROTOCOL_VERSION } from '../core/protocol';

// ── Event type ────────────────────────────────────────────────────────────────

export interface Event {
  readonly id:              string;        // Content-derived identifier (first 32 hex chars of hash of fields)
  readonly type:            string;        // Event class (e.g. 'TASK', 'TRANSFER')
  readonly actor:           string;        // Identity of the node/user that created this event
  readonly timestamp:       number;        // Wall-clock ms at creation (not used for ordering)
  readonly payload:         unknown;       // Arbitrary event-specific data
  readonly hash:            string;        // SHA-256 of canonical fields (excluding hash/id)
  readonly prevHash:        string | null; // Hash of preceding event in this actor's chain
  readonly protocolVersion: number;        // Must match HASH_PROTOCOL_VERSION
  readonly signature?:      string;        // Optional: cryptographic signature by actor
}

// ── ID derivation ─────────────────────────────────────────────────────────────

/**
 * Deterministically derive an event's id from its content fields.
 * Same inputs always produce the same id, on any node.
 */
export function deriveId(
  type:      string,
  actor:     string,
  timestamp: number,
  payload:   unknown,
  prevHash:  string | null,
): string {
  return sha256(canonicalJSON({ type, actor, timestamp, payload, prevHash })).slice(0, 32);
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a new, frozen Event.
 *
 * @param type    - Event type string (should be in your event registry)
 * @param actor   - Identity of the creator
 * @param payload - Event data (must be JSON-serializable)
 * @param prevHash - Hash of the actor's previous event (null for first event)
 */
export function createEvent(
  type:      string,
  actor:     string,
  payload:   unknown,
  prevHash:  string | null = null,
): Event {
  const timestamp = Date.now();
  const id        = deriveId(type, actor, timestamp, payload, prevHash);
  const hash      = hashEvent({ id, type, actor, timestamp, payload, prevHash });

  return Object.freeze({
    id,
    type,
    actor,
    timestamp,
    payload,
    hash,
    prevHash,
    protocolVersion: HASH_PROTOCOL_VERSION,
  }) as Event;
}

// ── Signature helpers ─────────────────────────────────────────────────────────

/**
 * Sign an event hash with an Ed25519 private key (stub — replace with real crypto in production).
 * Returns a hex signature string.
 */
export function signEvent(event: Event, privateKeyHex: string): string {
  // Stub: in production use node:crypto Ed25519 or libsodium
  const hmac = crypto.createHmac('sha256', Buffer.from(privateKeyHex, 'hex'));
  hmac.update(event.hash);
  return hmac.digest('hex');
}

/**
 * Verify an event's signature.
 * Returns true if valid, false otherwise.
 * Stub — in production replace with real asymmetric verification.
 */
export function verifySignature(event: Event, publicKeyHex: string): boolean {
  // Stub: always returns true when no signature is present (permissive mode)
  // Real implementation would verify Ed25519/ECDSA signature against event.hash
  if (!event.signature) return true;
  return typeof event.signature === 'string' && event.signature.length > 0;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Type guard: check if a value is an Event.
 */
export function isEvent(value: unknown): value is Event {
  if (!value || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    typeof e.type === 'string' &&
    typeof e.actor === 'string' &&
    typeof e.timestamp === 'number' &&
    typeof e.hash === 'string' &&
    typeof e.protocolVersion === 'number' &&
    e.type !== 'REJECTION'
  );
}