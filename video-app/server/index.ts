import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { loadKeysFromDirectus } from './load-keys.js';

// Load API keys from Directus before anything else
await loadKeysFromDirectus();

import apiRouter from './routes.js';
import { listProjects, updateProject } from './db.js';

// Reset projects stuck in active states (server was restarted mid-generation)
try {
  const all = await listProjects();
  const stuck = all.filter(p => ['generating_images', 'animating', 'assembling'].includes(p.status));
  for (const p of stuck) {
    await updateProject(p.id, {
      status: 'error',
      error: 'Сервер был перезапущен во время генерации. Нажмите «Продолжить» или «Заново».',
      progressMessage: 'Генерация прервана (перезапуск сервера)',
    });
    console.log(`[startup] Reset stuck project ${p.id} (was: ${p.status})`);
  }
} catch (e: any) {
  console.warn('[startup] Could not reset stuck projects:', e.message);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.VIDEO_APP_PORT ? parseInt(process.env.VIDEO_APP_PORT) : 3001;
const isDev = process.env.NODE_ENV !== 'production';

const app = express();

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));

// API routes — доступны как /api (прямой доступ) и /video-app/api (через прокси)
app.use('/api', apiRouter);
app.use('/video-app/api', apiRouter);

// Serve static video/image files
const dataDir = path.resolve(__dirname, '../data');
app.use('/data', express.static(dataDir));

// Serve pre-built static files.
// Must handle BOTH /video-app/* (proxied via main domain) and /* (direct port 3001 access).
const distPath = path.resolve(__dirname, '../dist');
const noCache = (_res: any, filePath: string) => {
  if (filePath.endsWith('.html')) _res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
};
app.use('/video-app', express.static(distPath, { setHeaders: noCache }));
app.get('/video-app/*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(distPath, 'index.html'));
});
app.use(express.static(distPath, { setHeaders: noCache }));
app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[video-gen] Server running on port ${PORT}`);
  console.log(`[video-gen] API: http://localhost:${PORT}/api`);
});

export default app;
