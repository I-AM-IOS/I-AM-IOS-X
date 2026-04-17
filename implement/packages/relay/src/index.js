#!/usr/bin/env node
import http from 'node:http';

const PORT             = parseInt(process.env.PORT ?? '8091', 10);
const VALIDATOR_URL    = process.env.VALIDATOR_ENDPOINT ?? 'http://localhost:8080';

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(payload);
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', c => { d += c; });
    req.on('end',  () => { try { resolve(JSON.parse(d || '{}')); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  if (req.method === 'GET' && req.url === '/health') {
    return json(res, 200, { status: 'ok', role: 'relay', validator: VALIDATOR_URL });
  }

  if (req.method === 'POST' && req.url === '/relay') {
    try {
      const body = await readBody(req);
      const upstream = await fetch(`${VALIDATOR_URL}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await upstream.json();
      return json(res, 200, { relayed: true, ...result });
    } catch (err) {
      return json(res, 502, { error: 'Upstream validator unreachable', detail: err.message });
    }
  }

  return json(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => console.log(`[relay] running on :${PORT} → ${VALIDATOR_URL}`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT',  () => server.close(() => process.exit(0)));
