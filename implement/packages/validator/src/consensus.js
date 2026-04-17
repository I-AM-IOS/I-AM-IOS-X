// ── BFT Consensus Engine ──────────────────────────────────────────────────────
// Lightweight single-node consensus suitable for development and small quorums.
// For production multi-node BFT see rekernel/consensus/*.ts

function fnv32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export class ConsensusEngine {
  constructor(quorum = 1) {
    this.quorum      = quorum;
    this.chain       = [];          // finalized records in order
    this.pending     = new Map();   // hash → { record, votes, ts }
    this.finalityMap = new Map();   // hash → { final, height, ts }
    this.height      = 0;
    this.headHash    = '0000000000000000';
  }

  // ── Submit an event for consensus ─────────────────────────────────────────
  submit(record) {
    const { hash } = record;
    if (!hash) throw new Error('Record missing hash field');

    // Already finalized — idempotent
    if (this.finalityMap.has(hash)) {
      return { accepted: true, hash, height: this.finalityMap.get(hash).height, alreadyFinal: true };
    }

    // Verify hash integrity
    const { hash: _h, prevHash, ...payload } = record;
    const expected = fnv32(JSON.stringify(payload) + '|' + (prevHash ?? '0000000000000000'));
    if (expected !== hash) {
      throw new Error(`Hash mismatch: expected ${expected}, got ${hash}`);
    }

    if (!this.pending.has(hash)) {
      this.pending.set(hash, { record, votes: 0, ts: Date.now() });
    }

    const entry = this.pending.get(hash);
    entry.votes += 1;

    // Reach quorum → finalize
    if (entry.votes >= this.quorum) {
      return this._finalize(hash, entry.record);
    }

    return { accepted: true, hash, queued: true, votes: entry.votes, quorum: this.quorum };
  }

  _finalize(hash, record) {
    this.chain.push({ ...record, finalHeight: this.height, finalTs: Date.now() });
    const height = this.height++;
    this.headHash = hash;
    this.finalityMap.set(hash, { final: true, height, ts: Date.now() });
    this.pending.delete(hash);
    return { accepted: true, hash, height, final: true };
  }

  // ── Query finality status ─────────────────────────────────────────────────
  getFinality(hash) {
    if (this.finalityMap.has(hash)) return this.finalityMap.get(hash);
    if (this.pending.has(hash)) {
      const e = this.pending.get(hash);
      return { final: false, votes: e.votes, quorum: this.quorum };
    }
    return { final: false, unknown: true };
  }

  // ── Chain state ───────────────────────────────────────────────────────────
  getStatus() {
    return {
      height:      this.height,
      headHash:    this.headHash,
      chainLength: this.chain.length,
      pending:     this.pending.size,
      quorum:      this.quorum,
    };
  }

  getChain(fromHeight = 0) {
    return this.chain.slice(fromHeight);
  }
}
