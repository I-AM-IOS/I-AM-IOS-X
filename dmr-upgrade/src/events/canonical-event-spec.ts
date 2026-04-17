/**
 * CANONICAL EVENT SPEC — Task 2
 *
 * Defines the authoritative, versioned schema for every event type
 * flowing through the I-AM-IOS overlay network. This is the single
 * source of truth for:
 *
 *   ES1: Type registry — every event type string is registered here.
 *   ES2: Field contracts — required vs optional fields per type.
 *   ES3: Validation gates — structural checks before ingress.
 *   ES4: Version negotiation — how older nodes handle unknown types.
 *   ES5: Wire format — canonical serialization for hash computation.
 *
 * All event types from dag-events.ts are registered in OVERLAY_EVENT_REGISTRY.
 */

import { canonicalSort } from '../determinism/logical-clock';

// ── ES1: Type Registry ───────────────────────────────────────────────────────

export const SPEC_VERSION = 2;

/** All known overlay event types with their schema metadata. */
export interface EventSpec {
  /** The event type string (namespaced). */
  type:         string;
  /** Human-readable description. */
  description:  string;
  /** Protocol version this type was introduced. */
  since:        number;
  /** Required top-level payload fields. */
  requiredFields: string[];
  /** Optional payload fields (present = validated if given). */
  optionalFields?: string[];
  /** Whether this event mutates overlay state (vs audit-only). */
  stateChanging: boolean;
  /** Whether missing in older peers should cause rejection. */
  critical:     boolean;
}

export const OVERLAY_EVENT_REGISTRY: ReadonlyMap<string, EventSpec> =
  new Map<string, EventSpec>([
    // ── Identity ──
    ['overlay.CID_CREATED', {
      type: 'overlay.CID_CREATED',
      description: 'A new CID identity was registered on the overlay.',
      since: 1, stateChanging: true, critical: true,
      requiredFields: ['record'],
    }],
    ['overlay.CID_ROTATED', {
      type: 'overlay.CID_ROTATED',
      description: 'A CID rotated its signing key. Old CID becomes invalid.',
      since: 1, stateChanging: true, critical: true,
      requiredFields: ['oldCID', 'newRecord', 'prevRecordHash'],
    }],
    ['overlay.CID_REVOKED', {
      type: 'overlay.CID_REVOKED',
      description: 'A CID was revoked by the owning or authorized party.',
      since: 1, stateChanging: true, critical: true,
      requiredFields: ['cid', 'reason', 'revokedBy'],
    }],
    // ── Capability ──
    ['overlay.CAP_ISSUED', {
      type: 'overlay.CAP_ISSUED',
      description: 'A capability token was granted from issuer to subject.',
      since: 1, stateChanging: true, critical: true,
      requiredFields: ['token'],
    }],
    ['overlay.CAP_REVOKED', {
      type: 'overlay.CAP_REVOKED',
      description: 'A capability token was revoked.',
      since: 1, stateChanging: true, critical: true,
      requiredFields: ['capId', 'reason', 'revokedBy'],
    }],
    // ── Peer Discovery ──
    ['overlay.PEER_DISCOVERED', {
      type: 'overlay.PEER_DISCOVERED',
      description: 'A new peer was discovered via gossip or bootstrap.',
      since: 1, stateChanging: true, critical: false,
      requiredFields: ['peerCID', 'endpoints', 'via'],
    }],
    ['overlay.PEER_LOST', {
      type: 'overlay.PEER_LOST',
      description: 'A peer became unreachable (timeout, disconnect, error).',
      since: 1, stateChanging: true, critical: false,
      requiredFields: ['peerCID', 'reason', 'lastSeen'],
    }],
    ['overlay.ENDPOINT_UPDATED', {
      type: 'overlay.ENDPOINT_UPDATED',
      description: 'A peer updated its reachable endpoints.',
      since: 1, stateChanging: true, critical: false,
      requiredFields: ['cid', 'endpoints'],
    }],
    // ── Sessions ──
    ['overlay.SESSION_ESTABLISHED', {
      type: 'overlay.SESSION_ESTABLISHED',
      description: 'A session was established between two CID-identified peers.',
      since: 1, stateChanging: true, critical: false,
      requiredFields: ['localCID', 'remoteCID', 'sessionId', 'transport', 'capId'],
    }],
    ['overlay.SESSION_CLOSED', {
      type: 'overlay.SESSION_CLOSED',
      description: 'A session closed normally or due to error/revocation.',
      since: 1, stateChanging: true, critical: false,
      requiredFields: ['sessionId', 'reason', 'durationMs'],
    }],
    // ── Consensus ──
    ['overlay.CONSENSUS_FINALIZED', {
      type: 'overlay.CONSENSUS_FINALIZED',
      description: 'A block of events was finalized by the validator set.',
      since: 1, stateChanging: false, critical: true,
      requiredFields: ['stateRoot', 'height', 'validators'],
    }],
    // ── DMR Routing (v2) ──
    ['overlay.ROUTE_SET_COMPUTED', {
      type: 'overlay.ROUTE_SET_COMPUTED',
      description: 'A canonical route set was computed for a (local, target) pair.',
      since: 2, stateChanging: true, critical: false,
      requiredFields: ['localCID', 'targetCID', 'primaryHops', 'backupHops', 'stateHash', 'protocolVersion'],
    }],
    ['overlay.ROUTE_ACTIVATED_PRIMARY', {
      type: 'overlay.ROUTE_ACTIVATED_PRIMARY',
      description: 'The primary route path was activated for a session.',
      since: 2, stateChanging: false, critical: false,
      requiredFields: ['localCID', 'targetCID', 'sessionId', 'primaryHops', 'stateHash'],
    }],
    ['overlay.ROUTE_FAILOVER_TRIGGERED', {
      type: 'overlay.ROUTE_FAILOVER_TRIGGERED',
      description: 'A deterministic failover trigger fired on the active path.',
      since: 2, stateChanging: false, critical: false,
      requiredFields: ['localCID', 'targetCID', 'sessionId', 'trigger', 'failedHops'],
      optionalFields: ['nextHops'],
    }],
    ['overlay.ROUTE_SWITCHED', {
      type: 'overlay.ROUTE_SWITCHED',
      description: 'Active path switched from primary to a backup.',
      since: 2, stateChanging: false, critical: false,
      requiredFields: ['localCID', 'targetCID', 'sessionId', 'fromHops', 'toHops', 'trigger'],
    }],
  ]);

// ── ES2/ES3: Validation ──────────────────────────────────────────────────────

export type SpecValidationResult =
  | { ok: true; spec: EventSpec }
  | { ok: false; code: string; reason: string };

/**
 * Validate an event against the canonical event spec.
 *
 * Checks:
 *   ESV1: Type is registered.
 *   ESV2: Protocol version is compatible with local spec.
 *   ESV3: All required payload fields are present and non-null.
 *   ESV4: No extra unknown fields (strict mode only).
 */
export function validateAgainstSpec(
  type:    string,
  payload: Record<string, unknown>,
  opts: {
    strict?:          boolean;  // Reject unknown payload fields
    remoteVersion?:   number;   // For version negotiation (ES4)
  } = {},
): SpecValidationResult {
  const spec = OVERLAY_EVENT_REGISTRY.get(type);

  // ESV1: Known type
  if (!spec) {
    return {
      ok:     false,
      code:   'ESV1',
      reason: `Unknown event type: "${type}". Register it in OVERLAY_EVENT_REGISTRY.`,
    };
  }

  // ESV2: Version compatibility
  const peerVersion = opts.remoteVersion ?? SPEC_VERSION;
  if (spec.since > peerVersion) {
    return {
      ok:     false,
      code:   'ESV2',
      reason: `Event type "${type}" requires spec v${spec.since}, but peer is at v${peerVersion}.`,
    };
  }

  // ESV3: Required fields
  for (const field of spec.requiredFields) {
    if (payload[field] === undefined || payload[field] === null) {
      return {
        ok:     false,
        code:   'ESV3',
        reason: `Required field "${field}" missing or null in payload for "${type}".`,
      };
    }
  }

  // ESV4: Strict mode — no unknown fields
  if (opts.strict) {
    const known = new Set([
      ...(spec.requiredFields ?? []),
      ...(spec.optionalFields ?? []),
    ]);
    const unknown = Object.keys(payload).filter(k => !known.has(k));
    if (unknown.length > 0) {
      return {
        ok:     false,
        code:   'ESV4',
        reason: `Unknown payload fields [${unknown.join(', ')}] for "${type}".`,
      };
    }
  }

  return { ok: true, spec };
}

// ── ES4: Version Negotiation ─────────────────────────────────────────────────

export interface VersionHandshake {
  localVersion:  number;
  remoteVersion: number;
}

/**
 * Determine the negotiated spec version between two peers.
 * The lower of the two versions wins; critical events from the higher
 * version are rejected if the peer doesn't understand them.
 */
export function negotiateVersion(h: VersionHandshake): {
  negotiated: number;
  downgraded: boolean;
} {
  const negotiated = Math.min(h.localVersion, h.remoteVersion);
  return { negotiated, downgraded: negotiated < h.localVersion };
}

/**
 * Filter out event types the remote peer doesn't support.
 * Non-critical events that require a higher version are silently dropped;
 * critical ones cause an error.
 */
export function filterForPeer(
  types:   string[],
  peerVersion: number,
): { allowed: string[]; rejected: { type: string; reason: string }[] } {
  const allowed: string[] = [];
  const rejected: { type: string; reason: string }[] = [];

  for (const t of types) {
    const spec = OVERLAY_EVENT_REGISTRY.get(t);
    if (!spec || spec.since <= peerVersion) {
      allowed.push(t);
    } else {
      rejected.push({
        type:   t,
        reason: `Requires spec v${spec.since}, peer is at v${peerVersion}`,
      });
    }
  }
  return { allowed, rejected };
}

// ── ES5: Wire Format ─────────────────────────────────────────────────────────

/**
 * Canonical wire format for an event — used for hashing and signing.
 * Field order is fixed so serialization is identical on all nodes.
 *
 * NOTE: Do NOT include `id` or `hash` in the wire body — they are
 * derived from this canonical representation.
 */
export interface CanonicalEventWire {
  actor:           string;
  lc:              number;   // Lamport clock tick
  payload:         unknown;
  prevHash:        string | null;
  protocolVersion: number;
  timestamp:       number;   // HLC-encoded (see logical-clock.ts)
  type:            string;
}

/**
 * Produce the canonical wire object from event fields.
 * All string arrays in the payload are sorted before encoding.
 */
export function toCanonicalWire(
  fields: CanonicalEventWire,
): CanonicalEventWire {
  return {
    actor:           fields.actor,
    lc:              fields.lc,
    payload:         normalizePayload(fields.payload),
    prevHash:        fields.prevHash,
    protocolVersion: fields.protocolVersion,
    timestamp:       fields.timestamp,
    type:            fields.type,
  };
}

/** Recursively sort array fields in a payload for canonical encoding. */
function normalizePayload(p: unknown): unknown {
  if (Array.isArray(p)) {
    const arr = p.map(normalizePayload);
    // Only sort arrays of primitive strings; leave structured arrays ordered
    if (arr.every(x => typeof x === 'string')) {
      return canonicalSort(arr as string[]);
    }
    return arr;
  }
  if (p !== null && typeof p === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(p as object).sort()) {
      out[k] = normalizePayload((p as Record<string, unknown>)[k]);
    }
    return out;
  }
  return p;
}