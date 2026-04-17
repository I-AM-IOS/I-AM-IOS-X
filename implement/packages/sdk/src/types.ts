// ════════════════════════════════════════════════════════════════════════════
//  @i-am-ios/sdk  —  Core types
// ════════════════════════════════════════════════════════════════════════════

// ── Events ────────────────────────────────────────────────────────────────────

export interface SovereignEvent<T = unknown> {
  /** Event type — use SCREAMING_SNAKE_CASE by convention */
  readonly type:      string;
  /** Arbitrary payload */
  readonly payload?:  T;
  /** Auto-assigned by SovereignLog.emit() */
  readonly id?:       string;
  readonly timestamp?: number;
  readonly nodeId?:   string;
  /** FNV-32 hash chain link: hash(prev_hash + type + payload) */
  readonly hash?:     string;
  readonly prevHash?: string;
  /** Protocol version — bump only on breaking changes */
  readonly version?:  number;
}

// ── Network modes ─────────────────────────────────────────────────────────────

export type NetworkMode =
  | 'connecting'  // Initial state
  | 'online'      // Validator reachable — fast finality (1–6 s)
  | 'offline'     // No internet — pure P2P BFT
  | 'hybrid';     // Reconnecting / pending resync

// ── SovereignLog options ──────────────────────────────────────────────────────

export interface SovereignLogOptions {
  /** Node identifier — 'auto' generates a random one */
  nodeId?: string;
  /** Persist event log to IndexedDB (default: true in browser, false in Node) */
  persist?: boolean;
  /** Maximum events to keep in memory (default: 1000) */
  maxEvents?: number;
  /** Protocol version (default: 1) */
  protocolVersion?: number;
}

// ── HybridNetwork options ─────────────────────────────────────────────────────

export interface HybridNetworkOptions {
  /** Public validator endpoint (e.g. https://validator.i-am-ios.dev) */
  validatorEndpoint?: string;
  /** Fallback validator URLs tried in order */
  validatorBackups?: string[];
  /** Timeout (ms) before falling back to P2P (default: 2000) */
  fallbackTimeout?: number;
  /** How often to probe connectivity (ms, default: 5000) */
  checkInterval?: number;
  /** BFT quorum threshold (default: 0.67) */
  quorum?: number;
}

// ── State derivation ──────────────────────────────────────────────────────────

export type DeriveStateFn<S> = (events: readonly SovereignEvent[]) => S;

// ── Finality result ───────────────────────────────────────────────────────────

export interface FinalityResult {
  readonly eventId:    string;
  readonly hash:       string;
  readonly height:     number;
  readonly mode:       NetworkMode;
  readonly confirmedAt: number;
}

// ── ReKernel options ──────────────────────────────────────────────────────────

export interface ReKernelOptions {
  /** Enable 6-lock deterministic execution (default: true) */
  strict?: boolean;
}

// ── Ollama options ────────────────────────────────────────────────────────────

export interface OllamaOptions {
  host?:    string;   // default: http://localhost:11434
  model?:   string;   // default: mistral
  timeout?: number;   // ms — default: 30000
}

export interface OllamaResponse {
  text:     string;
  model:    string;
  done:     boolean;
  durationMs?: number;
}
