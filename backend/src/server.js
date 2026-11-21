// Koode backend: POST /api/plan (grounded planner), GET /health, and the
// demo site under /demo/. Zero runtime dependencies.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { planStep } from './planner.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEMO_DIR = path.resolve(here, '../../demo-site');
const LOG_DIR = path.resolve(here, '../logs');
const cfg = loadConfig();
// Test-only fault injection: KOODE_FAULT=stale_first returns an ID from an old
// snapshot on the first plan call, to prove the extension rejects stale IDs.
let faultPending = process.env.KOODE_FAULT === 'stale_first';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, { 'Content-Type': isObj ? 'application/json' : 'text/plain', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
}

function readBody(req, limit = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Audit log of exactly what was sent to the model (sanitised request) + result.
function audit(entry) {
  if (!cfg.logPayloads) return;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(path.join(LOG_DIR, 'plan-requests.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  } catch (e) {
    console.error('[audit] write failed', e.message);
  }
}

function serveStatic(req, res, urlPath) {
  let rel;
  try { rel = decodeURIComponent(urlPath.replace(/^\/demo\/?/, '')) || 'index.html'; } catch (_) { return send(res, 400, 'bad path'); }
  const file = path.resolve(DEMO_DIR, rel);
  if (!file.startsWith(DEMO_DIR)) return send(res, 403, 'forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'not found');
    send(res, 200, data, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (url.pathname === '/health') return send(res, 200, { ok: true, provider: cfg.provider, model: cfg.model, mock: cfg.provider === 'mock' });
  if (url.pathname === '/' ) return send(res, 302, '', { Location: '/demo/' });
  if (url.pathname.startsWith('/demo')) return serveStatic(req, res, url.pathname);
  if (url.pathname === '/api/plan' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      if (faultPending && body.snapshot && body.snapshot.candidates && body.snapshot.candidates.length) {
        faultPending = false;
        const staleId = 's0_' + body.snapshot.candidates[0].id.split('_')[1];
        console.log('[plan] FAULT INJECTION: returning stale id ' + staleId);
        return send(res, 200, { status: 'guide', target_id: staleId, instruction_en: 'fault injection', instruction_ml: '', planner: { provider: 'fault-injection', model: 'fault-injection', mock: true } });
      }
      const { req: sanitized, result } = await planStep(body, cfg);
      audit({ request: sanitized, result });
      console.log(`[plan] ${result.status} ${result.target_id || ''} ${result.latency_ms}ms ${cfg.provider}/${cfg.model} cands=${sanitized.snapshot.candidates.length} goal_chars=${sanitized.goal.length}`);
      return send(res, 200, result);
    } catch (e) {
      console.error('[plan] error', e.message);
      audit({ error: e.message });
      return send(res, 502, { error: e.message });
    }
  }
  send(res, 404, 'not found');
});

// Loopback only by default: the planner spends the operator's model quota.
server.listen(cfg.port, cfg.host, () => {
  console.log(`Koode backend on http://${cfg.host}:${cfg.port}  provider=${cfg.provider} model=${cfg.model}${cfg.provider === 'mock' ? '  (MOCK TEST HARNESS — not AI)' : ''}`);
});
