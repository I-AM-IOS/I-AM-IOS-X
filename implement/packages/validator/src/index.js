#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  services/validator/src/index.js  —  I-AM-IOS Validator Node
//  Endpoints:
//    GET  /health           → liveness probe
//    GET  /status           → consensus status
//    POST /submit           → accept event record for consensus
//    GET  /finality/:hash   → query finality of a submitted event
//    GET  /chain            → full finalized chain (paginated)
// ════════════════════════════════════════════════════════════════════════════

import http   from 'node:http';
import { ConsensusEngine } from './consensus.js';

const PORT   = parseInt(process.env.PORT ?? '8080', 10);
const HOST   = process.env.HOST   ?? '0.0.0.0';
const QUORUM = parseInt(process.env.QUORUM ?? '1', 10);

const consensus = new ConsensusEngine(QUORUM);

// ── Tiny router (no deps beyond node:http) ────────────────────────────────────
function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type':  'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(payload);
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end',  ()    => {
      try   { resolve(JSON.parse(data || '{}')); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const { method, url } = req;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  try {
    // GET /health
    if (method === 'GET' && url === '/health') {
      return json(res, 200, { status: 'ok', ts: Date.now(), height: consensus.height });
    }

    // GET /status
    if (method === 'GET' && url === '/status') {
      return json(res, 200, consensus.getStatus());
    }

    // POST /submit
    if (method === 'POST' && url === '/submit') {
      const record = await readBody(req);
      const result = consensus.submit(record);
      return json(res, 200, { ...result, timestamp: Date.now() });
    }

    // GET /finality/:hash
    const finalityMatch = url?.match(/^\/finality\/([0-9a-f]+)$/);
    if (method === 'GET' && finalityMatch) {
      const hash = finalityMatch[1];
      return json(res, 200, consensus.getFinality(hash));
    }

    // GET /chain?from=0&limit=100
    if (method === 'GET' && url?.startsWith('/chain')) {
      const params   = new URL(url, `http://${HOST}`).searchParams;
      const from     = parseInt(params.get('from')  ?? '0',   10);
      const limit    = parseInt(params.get('limit') ?? '100', 10);
      const chain    = consensus.getChain(from).slice(0, limit);
      return json(res, 200, { chain, height: consensus.height, count: chain.length });
    }

    return json(res, 404, { error: 'Not found' });

  } catch (err) {
    console.error('[validator] error:', err.message);
    return json(res, err.message?.includes('Hash mismatch') ? 400 : 500, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[validator] running on http://${HOST}:${PORT}`);
  console.log(`[validator] quorum=${QUORUM}`);
});

server.on('error', err => {
  console.error('[validator] server error:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT',  () => { server.close(() => process.exit(0)); });

export { server, consensus };
