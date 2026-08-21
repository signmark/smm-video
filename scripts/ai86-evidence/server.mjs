/**
 * AI-86 browser evidence server.
 *
 * Поднимает:
 *   - Static client server на :5101 (раздаёт dist/public).
 *   - Mock API server на :5102 с 5s delay на AI-86 endpoints.
 *   - index.html проксирует /api -> :5102 через прокси-скрипт.
 *
 * Запускать в background, после прогонять Playwright-сценарий.
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = '/root/smm-worktrees/ai86-v2/dist/public';
const API_PORT = 5102;
const CLIENT_PORT = 5101;

const DELAY_MS = 5000;
const delayed = (body, ms = DELAY_MS) => new Promise((resolve) => setTimeout(() => resolve(body), ms));

// --- Mock API endpoints ---
const apiHandlers = {
  // Auth — immediate (не для AI-86 demo; просто чтобы не зависнуть на init)
  'GET /api/auth/check': async () => ({ ok: true }),
  'GET /api/auth/me': async () => ({ id: 'u-1', email: 'browser@example.com', role: 'user' }),
  'POST /api/auth/login': async () => ({ token: 'mock', refresh_token: 'mock', user: { id: 'u-1', email: 'browser@example.com' } }),
  // AI-86 endpoints — 5s delay
  'GET /api/user/me': async () => delayed({ id: 'u-1', email: 'browser@example.com', role: 'user' }),
  'GET /api/proxy/me': async () => delayed({ id: 'u-1', email: 'browser@example.com', role: 'user' }),
  'GET /api/campaigns': async () => delayed([{ id: 'camp-1', name: 'Camp 1', createdAt: new Date().toISOString(), isAssistantActive: false }]),
  'GET /api/campaigns/list': async () => delayed({ data: [{ id: 'camp-1', name: 'Camp 1' }] }),
  'GET /api/campaigns/list-for-user': async () => delayed({ data: [{ id: 'camp-1', name: 'Camp 1' }] }),
  'GET /api/scheduled-publication/list': async () => delayed([]),
  'GET /api/sources': async () => delayed([]),
  'GET /api/sources/list': async () => delayed([]),
  'GET /api/trends': async () => delayed([]),
  'GET /api/trends/list': async () => delayed([]),
  'GET /api/keywords': async () => delayed([]),
  'GET /api/keywords/list': async () => delayed([]),
  'GET /api/campaign-content/stats': async () => delayed({ latest: [], recent: [] }),
  'GET /api/campaign-content/list': async () => delayed([]),
  'GET /api/campaign-content': async () => delayed([]),
  'GET /api/proxy/campaigns': async () => delayed({ data: [{ id: 'camp-1', name: 'Camp 1' }] }),
};

const apiServer = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const key = `${req.method} ${url}`;
  console.log(`[api ${req.method}] ${url}`);

  // Special: any GET /api/auth/me returns 200 with user.
  for (const [pattern, handler] of Object.entries(apiHandlers)) {
    const [method, path] = pattern.split(' ');
    if (req.method === method && url.startsWith(path.replace(/\/$/, ''))) {
      try {
        const body = await handler();
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        });
        res.end(JSON.stringify(body));
      } catch (e) {
        res.writeHead(500, { 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }
  }

  // Default: 200 with empty data immediately (avoid hanging on unknown endpoints)
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify({}));
});

apiServer.listen(API_PORT, '127.0.0.1', () => {
  console.log(`[ai86] Mock API listening on http://127.0.0.1:${API_PORT}`);
});

// --- Static client server with /api proxy ---
const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const proxyToApi = (req, res) => {
  const opts = {
    hostname: '127.0.0.1',
    port: API_PORT,
    path: req.url,
    method: req.method,
    headers: req.headers,
  };
  const proxyReq = http.request(opts, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxyReq.on('error', (e) => {
    res.writeHead(502);
    res.end('Bad gateway: ' + e.message);
  });
  req.pipe(proxyReq);
};

const clientServer = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    return proxyToApi(req, res);
  }
  let filePath = path.join(CLIENT_DIR, req.url === '/' ? 'index.html' : req.url);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(CLIENT_DIR, 'index.html');
  }
  const ext = path.extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  fs.createReadStream(filePath).pipe(res);
});

clientServer.listen(CLIENT_PORT, '127.0.0.1', () => {
  console.log(`[ai86] Client listening on http://127.0.0.1:${CLIENT_PORT}`);
});

process.on('SIGINT', () => {
  apiServer.close();
  clientServer.close();
  process.exit(0);
});