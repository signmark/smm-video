/**
 * E2E: resume / rebuild of the final video.
 *
 * Cost model:
 *  - The rebuild + self-heal tests re-assemble from ALREADY-SAVED clips + audio,
 *    so they make ZERO new FAL calls ($0). They are the default, always-on tests.
 *  - The optional full-generation test (RUN_FAL_GENERATION=1) PREFERS stock and
 *    refuses to run if the estimated FAL spend exceeds MAX_FAL_USD (default $5).
 *
 * Run against a LOCAL server (recommended — needed for the corrupt self-heal test):
 *   cd video-app
 *   VIDEO_E2E_URL=http://localhost:3001/api VIDEO_E2E_LOCAL_FS=1 \
 *     npx tsx --test e2e/rebuild.e2e.ts
 *
 * Pin a specific project (else the first `done` project is used):
 *   VIDEO_PROJECT_ID=358 ...
 *
 * Optional full stock generation (spends real money, capped at $5):
 *   RUN_FAL_GENERATION=1 MAX_FAL_USD=5 ...
 */

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { BASE_URL, TIMEOUTS } from './config.js';
import { get, post, pollUntil } from './helpers.js';
import { DATA_PATHS } from '../server/db.js';

const execFileAsync = promisify(execFile);

const LOCAL_FS = process.env.VIDEO_E2E_LOCAL_FS === '1';
const RUN_FAL = process.env.RUN_FAL_GENERATION === '1';
const MAX_FAL_USD = Number(process.env.MAX_FAL_USD ?? '5');
const COST_PER_FAL_CLIP = Number(process.env.FAL_COST_PER_CLIP ?? '0.5');

type Scene = { videoSource?: string };
type Project = {
  id: string;
  status: string;
  videoUrl?: string;
  script?: { scenes: Scene[]; stockPrechecked?: boolean };
};

/** Download a URL to a temp file and return its ffprobe duration in seconds. */
async function probeDownloadedDuration(url: string): Promise<number> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUTS.request) });
  assert.equal(res.status, 200, `download should be 200, got ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.length > 1000, `downloaded MP4 too small: ${buf.length} bytes`);
  // MP4 magic: bytes 4-8 should be 'ftyp' (or 'moov' for some muxes).
  const tag = buf.subarray(4, 8).toString('ascii');
  assert.ok(['ftyp', 'moov'].includes(tag), `not an MP4 (tag=${tag})`);

  const tmp = path.join(os.tmpdir(), `rebuild-e2e-${Date.now()}.mp4`);
  await fs.writeFile(tmp, buf);
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', tmp,
    ], { timeout: 15_000 });
    const d = parseFloat(stdout.trim());
    return isNaN(d) ? 0 : d;
  } finally {
    await fs.unlink(tmp).catch(() => {});
  }
}

let projectId: string;

before(async () => {
  console.log(`[rebuild.e2e] BASE_URL=${BASE_URL}`);
  if (process.env.VIDEO_PROJECT_ID) {
    projectId = process.env.VIDEO_PROJECT_ID;
    return;
  }
  const { body } = await get<Project[]>('/videos');
  assert.ok(Array.isArray(body), 'GET /videos should return an array');
  const done = body.find((p) => p.status === 'done');
  assert.ok(done, 'no `done` project found — set VIDEO_PROJECT_ID');
  projectId = done!.id;
  console.log(`[rebuild.e2e] using project ${projectId}`);
});

test('rebuild re-assembles a valid video from saved clips ($0 FAL)', async () => {
  const { status, body } = await post(`/videos/${projectId}/resume`, { mode: 'rebuild' });
  assert.equal(status, 200, `resume rebuild should accept, got ${status}: ${JSON.stringify(body)}`);

  const final = await pollUntil<Project>(
    `/videos/${projectId}`,
    (p) => p.status === 'done' || p.status === 'error',
    { timeoutMs: TIMEOUTS.generate, intervalMs: 4000 },
  );
  assert.equal(final.status, 'done', `rebuild must finish done, got ${final.status}`);

  const dur = await probeDownloadedDuration(`${BASE_URL}/videos/${projectId}/download`);
  assert.ok(dur > 1, `rebuilt video must be playable with duration > 1s, got ${dur}`);
  console.log(`[rebuild.e2e] rebuilt ${projectId}: duration=${dur.toFixed(1)}s`);
});

test('auto resume self-heals a corrupt final video ($0 FAL, local fs)', { skip: !LOCAL_FS ? 'set VIDEO_E2E_LOCAL_FS=1 (needs server filesystem)' : false }, async () => {
  const videoPath = DATA_PATHS.videoFile(projectId);
  const original = await fs.readFile(videoPath);
  // Simulate an interrupted assembly: truncate so the moov atom is gone.
  await fs.writeFile(videoPath, original.subarray(0, Math.floor(original.length / 2)));

  try {
    const { status } = await post(`/videos/${projectId}/resume`, { mode: 'auto' });
    assert.equal(status, 200);

    const final = await pollUntil<Project>(
      `/videos/${projectId}`,
      (p) => p.status === 'done' || p.status === 'error',
      { timeoutMs: TIMEOUTS.generate, intervalMs: 4000 },
    );
    assert.equal(final.status, 'done', 'auto resume must self-heal corrupt final → done');

    const dur = await probeDownloadedDuration(`${BASE_URL}/videos/${projectId}/download`);
    assert.ok(dur > 1, `self-healed video must be playable, got ${dur}`);
    console.log(`[rebuild.e2e] self-healed ${projectId}: duration=${dur.toFixed(1)}s`);
  } catch (err) {
    // Best-effort restore so a failure doesn't leave the project broken.
    await fs.writeFile(videoPath, original).catch(() => {});
    throw err;
  }
});

test('full stock-preferred generation, capped at $MAX_FAL_USD', { skip: !RUN_FAL ? 'set RUN_FAL_GENERATION=1 to spend real FAL credits' : false }, async () => {
  // Create a stock-friendly project (generic visuals → likely Pexels matches).
  const create = await post<Project>('/videos', {
    title: '[E2E Rebuild] stock budget',
    topic: 'Утренняя пробежка в городском парке',
    format: '9:16',
    duration: 20,
    language: 'ru',
    animationModel: 'kling',
  });
  assert.equal(create.status, 200, `create should succeed: ${JSON.stringify(create.body)}`);
  const id = create.body.id;

  try {
    // Wait for script + stock precheck so we know how many scenes need FAL.
    const ready = await pollUntil<Project>(
      `/videos/${id}`,
      (p) => p.status === 'script_ready' && p.script?.stockPrechecked === true,
      { timeoutMs: TIMEOUTS.stockPrecheck, intervalMs: 3000 },
    );
    const scenes = ready.script?.scenes ?? [];
    const falScenes = scenes.filter((s) => s.videoSource !== 'stock').length;
    const estimate = falScenes * COST_PER_FAL_CLIP;
    console.log(`[rebuild.e2e] scenes=${scenes.length} fal=${falScenes} est=$${estimate.toFixed(2)} cap=$${MAX_FAL_USD}`);
    assert.ok(estimate <= MAX_FAL_USD, `estimated FAL spend $${estimate} exceeds cap $${MAX_FAL_USD} — aborting before generation`);

    const gen = await post(`/videos/${id}/generate`, {});
    assert.equal(gen.status, 200);

    const final = await pollUntil<Project>(
      `/videos/${id}`,
      (p) => p.status === 'done' || p.status === 'error',
      { timeoutMs: TIMEOUTS.generate, intervalMs: 5000 },
    );
    assert.equal(final.status, 'done', `generation must finish done, got ${final.status}`);

    const dur = await probeDownloadedDuration(`${BASE_URL}/videos/${id}/download`);
    assert.ok(dur > 5, `generated video must be playable, got ${dur}`);
    console.log(`[rebuild.e2e] generated ${id}: duration=${dur.toFixed(1)}s`);
  } finally {
    // Clean up the throwaway project.
    await fetch(`${BASE_URL}/videos/${id}`, { method: 'DELETE' }).catch(() => {});
  }
});
