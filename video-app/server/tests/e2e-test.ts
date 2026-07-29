/**
 * End-to-End Tests — Video App
 *
 * Tests the full stack: HTTP API → DB (Directus) → ffmpeg pipeline → output file.
 *
 * Groups:
 *   A01-A06   HTTP API: project CRUD + validation
 *   B07-B14   HTTP API: scene patching + error handling + field storage
 *   C15-C20   Assembly e2e: flash-cut, colour grading, format normalisation
 *   D21-D25   Ken Burns e2e: real JPEG → animated static clip → verify properties
 *   E26-E28   Title card e2e: ffmpeg drawtext → verify MP4 file
 *   F29-F32   Viral pipeline e2e: assemble 3-role scenes → subtitle burn
 *   G33-G38   Input validation: topic/scenario length limits + selectedVariant range
 *
 * Prerequisites:
 *   • Video App server running on port 3001  (cd video-app && npx tsx server/index.ts)
 *   • Directus reachable (DIRECTUS_URL + DIRECTUS_STATIC_TOKEN env vars)
 *
 * Run:
 *   cd video-app && npx tsx server/tests/e2e-test.ts
 */

import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { execFileSync } from 'child_process';

const execFileAsync = promisify(execFile);

// ── config ────────────────────────────────────────────────────────────────────

const BASE_URL = 'http://localhost:3001/api';
const TIMEOUT_MS = 10_000;

const FFMPEG = (() => {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return 'ffmpeg'; } catch {}
  return 'ffmpeg'; // fallback — tests will warn if not found
})();

async function probe(filePath: string): Promise<number> {
  const ffprobe = FFMPEG === 'ffmpeg' ? 'ffprobe' : FFMPEG.replace(/ffmpeg([^/]*)$/, 'ffprobe$1');
  try {
    const { stdout } = await execFileAsync(ffprobe, [
      '-v', 'quiet', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
    ]);
    return parseFloat(stdout.trim()) || 0;
  } catch { return 0; }
}

async function probeResolution(filePath: string): Promise<{ w: number; h: number }> {
  const ffprobe = FFMPEG === 'ffmpeg' ? 'ffprobe' : FFMPEG.replace(/ffmpeg([^/]*)$/, 'ffprobe$1');
  try {
    const { stdout } = await execFileAsync(ffprobe, [
      '-v', 'quiet', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'csv=s=x:p=0', filePath,
    ]);
    const parts = stdout.trim().split('x');
    return { w: parseInt(parts[0]) || 0, h: parseInt(parts[1]) || 0 };
  } catch { return { w: 0, h: 0 }; }
}

async function hasAudioStream(filePath: string): Promise<boolean> {
  const ffprobe = FFMPEG === 'ffmpeg' ? 'ffprobe' : FFMPEG.replace(/ffmpeg([^/]*)$/, 'ffprobe$1');
  try {
    const { stdout } = await execFileAsync(ffprobe, [
      '-v', 'quiet', '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_type',
      '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
    ]);
    return stdout.trim() === 'audio';
  } catch { return false; }
}

// ── test harness ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function ok(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.error(`  ❌ ${name}${detail ? `\n       ${detail}` : ''}`);
    failed++;
    failures.push(name);
  }
}

function section(title: string) { console.log(`\n── ${title} ──`); }

async function apiGet(path: string): Promise<{ status: number; body: any }> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}`, { signal: ctrl.signal });
    clearTimeout(tid);
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } catch (e: any) {
    clearTimeout(tid);
    throw e;
  }
}

async function apiPost(path: string, data: any): Promise<{ status: number; body: any }> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } catch (e: any) {
    clearTimeout(tid);
    throw e;
  }
}

async function apiPatch(path: string, data: any): Promise<{ status: number; body: any }> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } catch (e: any) {
    clearTimeout(tid);
    throw e;
  }
}

async function apiDelete(path: string): Promise<{ status: number; body: any }> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}`, { method: 'DELETE', signal: ctrl.signal });
    clearTimeout(tid);
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } catch (e: any) {
    clearTimeout(tid);
    throw e;
  }
}

// ── check server reachability ─────────────────────────────────────────────────

let serverOk = false;
try {
  const res = await fetch(`${BASE_URL}/videos`, { signal: AbortSignal.timeout(4000) });
  serverOk = res.status < 500;
} catch {}

if (!serverOk) {
  console.error(`\n❌ Video App server not reachable at ${BASE_URL}`);
  console.error('   Start it first:  cd video-app && npx tsx server/index.ts');
  process.exit(1);
}
console.log(`✅ Server reachable at ${BASE_URL}\n`);

// ── synthetic clip helper ─────────────────────────────────────────────────────

async function makeTestClip(outputPath: string, durationSec: number, w = 1080, h = 1920, color = 'blue'): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await execFileAsync(FFMPEG, [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-t', String(durationSec), '-i', `color=c=${color}:s=${w}x${h}:rate=25`,
    '-f', 'lavfi', '-t', String(durationSec), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-t', String(durationSec),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '35', '-r', '25', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '64k',
    outputPath,
  ], { timeout: 30_000 });
}

async function makeTestJpeg(outputPath: string, w = 640, h = 480, color = 'red'): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await execFileAsync(FFMPEG, [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=${color}:s=${w}x${h}`,
    '-frames:v', '1',
    outputPath,
  ], { timeout: 10_000 });
}

const TMP = path.join(os.tmpdir(), `e2e-test-${Date.now()}`);
await fs.mkdir(TMP, { recursive: true });

// ── A: HTTP API CRUD ──────────────────────────────────────────────────────────

section('A01-A06  HTTP API: Project CRUD');

let createdId: string | null = null;

{
  // A01: POST /videos creates a project with status 201
  const r = await apiPost('/videos', { topic: 'E2E тест', format: '9:16', duration: 15, language: 'ru' });
  ok('A01 POST /videos → 201', r.status === 201, `got ${r.status}: ${JSON.stringify(r.body)}`);
  ok('A02 POST /videos → body has id', typeof r.body?.id === 'string', `body=${JSON.stringify(r.body)}`);
  ok('A03 POST /videos → status="idle"', r.body?.status === 'idle', `status=${r.body?.status}`);
  createdId = r.body?.id ?? null;

  // A04: GET /videos/:id returns the created project
  if (createdId) {
    const g = await apiGet(`/videos/${createdId}`);
    ok('A04 GET /videos/:id → 200', g.status === 200);
    ok('A05 GET /videos/:id → topic matches', g.body?.topic === 'E2E тест', `got="${g.body?.topic}"`);
  } else {
    ok('A04 GET /videos/:id → 200', false, 'no id from create');
    ok('A05 GET /videos/:id → topic matches', false, 'no id from create');
  }

  // A06: GET /videos lists projects — includes the newly created one
  const list = await apiGet('/videos');
  const found = Array.isArray(list.body) && list.body.some((p: any) => p.id === createdId);
  ok('A06 GET /videos → list includes new project', found);
}

// ── B: Validation + error handling ───────────────────────────────────────────

section('B07-B12  HTTP API: Validation + error cases');

{
  // B07: missing format → 400
  const r1 = await apiPost('/videos', { topic: 'Test', duration: 15 });
  ok('B07 POST /videos without format → 400', r1.status === 400, `got ${r1.status}`);

  // B08: invalid format → 400
  const r2 = await apiPost('/videos', { topic: 'Test', format: 'banana', duration: 15 });
  ok('B08 POST /videos invalid format → 400', r2.status === 400, `got ${r2.status}`);

  // B09: missing topic/scenario/landingUrl → 400
  const r3 = await apiPost('/videos', { format: '9:16', duration: 15 });
  ok('B09 POST /videos without topic → 400', r3.status === 400, `got ${r3.status}`);

  // B10: GET non-existent project → 404
  const r4 = await apiGet('/videos/nonexistent-id-xyz-12345');
  ok('B10 GET /videos/nonexistent → 404', r4.status === 404, `got ${r4.status}`);

  // B11: DELETE non-existent → 404
  const r5 = await apiDelete('/videos/nonexistent-id-xyz-12345');
  ok('B11 DELETE /videos/nonexistent → 404', r5.status === 404, `got ${r5.status}`);

  // B12: PATCH scene on project without script → 400
  if (createdId) {
    const r6 = await apiPatch(`/videos/${createdId}/scenes/fakesceneid`, { text: 'hello' });
    ok('B12 PATCH scene on project without script → 400', r6.status === 400, `got ${r6.status}`);
  } else {
    ok('B12 PATCH scene on project without script → 400', false, 'no project id');
  }
}

// ── scene patch after injecting a mock script ─────────────────────────────────

section('B13-B14  HTTP API: Scene patch with mock script');

{
  if (createdId) {
    // Inject a mock script directly via updateProject-equivalent (POST /videos/:id/reset won't help here)
    // We test PATCH once we have a project with script by creating a second project through generate-script
    // (that's async, hard to test e2e without real AI). Instead test validation: PATCH on no-script → 400
    // was already B12. Here we verify the full round-trip: create → check fields saved correctly.

    const r = await apiGet(`/videos/${createdId}`);
    ok('B13 GET project → format stored correctly', r.body?.format === '9:16', `got="${r.body?.format}"`);
    ok('B14 GET project → language stored correctly', r.body?.language === 'ru', `got="${r.body?.language}"`);
  } else {
    ok('B13 GET project → format stored correctly', false, 'no id');
    ok('B14 GET project → language stored correctly', false, 'no id');
  }
}

// ── C: Assembly e2e via service layer ────────────────────────────────────────

section('C15-C20  Assembly e2e: flash-cut + colour grading + format normalisation');

{
  const { assembleFromClips } = await import('../services/video-assembler.js');

  // Create 3 synthetic clips at different resolutions to simulate real-world input
  const clip0 = path.join(TMP, 'c_clip0.mp4');
  const clip1 = path.join(TMP, 'c_clip1.mp4');
  const clip2 = path.join(TMP, 'c_clip2.mp4');
  await makeTestClip(clip0, 5, 1080, 1920, 'red');     // hook — native 9:16
  await makeTestClip(clip1, 5,  480,  832, 'green');    // body — WAN 480p
  await makeTestClip(clip2, 5,  720, 1280, 'blue');     // cta  — 720p

  const outFlash  = path.join(TMP, 'c_flash_out.mp4');
  const tempFlash = path.join(TMP, 'c_flash_tmp');

  const durs = await assembleFromClips({
    scenes: [
      { clipPath: clip0, duration: 5, role: 'hook' },
      { clipPath: clip1, duration: 5, role: 'body' },
      { clipPath: clip2, duration: 5, role: 'cta'  },
    ],
    outputPath: outFlash,
    tempDir: tempFlash,
    format: '9:16',
    flashCut: true,
  });

  // C15: output file exists
  let exists = false;
  try { await fs.access(outFlash); exists = true; } catch {}
  ok('C15 assembleFromClips (flashCut) → output file created', exists);

  // C16: actualDurations array has 3 entries
  ok('C16 assembleFromClips → returns 3 actualDurations', durs.length === 3, `got ${durs.length}`);

  // C17: each actualDuration ≈ 5s (within 0.5s tolerance)
  const driftOk = durs.every(d => Math.abs(d - 5) < 0.5);
  ok('C17 each actualDuration ≈ 5s (within 0.5s)', driftOk, `durs=${durs.map(d=>d.toFixed(3))}`);

  // C18: output resolution = 1080×1920 (format normalisation)
  const { w, h } = await probeResolution(outFlash);
  ok('C18 output resolution = 1080×1920 (format normalised)', w === 1080 && h === 1920, `got ${w}×${h}`);

  // C19: total video duration ≈ 3×5 + 2×0.12 (flash clips)
  const totalDur = await probe(outFlash);
  const expectedDur = 3 * 5 + 2 * 0.12;  // 15.24s
  ok('C19 total duration ≈ 15.24s (3 scenes + 2 flash clips)', Math.abs(totalDur - expectedDur) < 0.5,
    `got ${totalDur.toFixed(3)}s, expected ≈${expectedDur.toFixed(3)}s`);

  // C20: output has audio stream
  const hasAudio = await hasAudioStream(outFlash);
  ok('C20 output has audio stream', hasAudio);
}

// ── D: Ken Burns e2e ──────────────────────────────────────────────────────────

section('D21-D25  Ken Burns e2e: JPEG → animated static clip');

{
  const { makeStaticClipFromImage } = await import('../services/video-assembler.js');

  const jpeg = path.join(TMP, 'd_frame.jpg');
  await makeTestJpeg(jpeg, 640, 480, 'orange');

  // D21: Ken Burns preset 0 (zoom-in center) — 5s clip
  const out0 = path.join(TMP, 'd_kb0.mp4');
  await makeStaticClipFromImage({ imagePath: jpeg, durationSeconds: 5, outputPath: out0, kenBurns: true, format: '9:16', sceneIndex: 0 });
  const dur0 = await probe(out0);
  ok('D21 Ken Burns preset 0: output file created', dur0 > 0);
  ok('D22 Ken Burns preset 0: duration ≈ 5s', Math.abs(dur0 - 5) < 0.3, `got ${dur0.toFixed(3)}s`);

  // D23: Ken Burns preset 1 (zoom-in upward pan)
  const out1 = path.join(TMP, 'd_kb1.mp4');
  await makeStaticClipFromImage({ imagePath: jpeg, durationSeconds: 3, outputPath: out1, kenBurns: true, format: '9:16', sceneIndex: 1 });
  const dur1 = await probe(out1);
  ok('D23 Ken Burns preset 1: duration ≈ 3s', Math.abs(dur1 - 3) < 0.3, `got ${dur1.toFixed(3)}s`);

  // D24: resolution normalised to 1080×1920
  const { w: w0, h: h0 } = await probeResolution(out0);
  ok('D24 Ken Burns output resolution = 1080×1920', w0 === 1080 && h0 === 1920, `got ${w0}×${h0}`);

  // D25: kenBurns=false still produces correct clip
  const outNoKb = path.join(TMP, 'd_nokb.mp4');
  await makeStaticClipFromImage({ imagePath: jpeg, durationSeconds: 4, outputPath: outNoKb, kenBurns: false, format: '16:9' });
  const durNoKb = await probe(outNoKb);
  const { w: wNoKb, h: hNoKb } = await probeResolution(outNoKb);
  ok('D25 kenBurns=false: 16:9 clip created and resolution = 1920×1080', wNoKb === 1920 && hNoKb === 1080, `got ${wNoKb}×${hNoKb}`);
}

// ── E: Title Card e2e ─────────────────────────────────────────────────────────

section('E26-E28  Title card e2e: drawtext → MP4');

{
  const { makeTitleCardClip } = await import('../services/video-assembler.js');

  // E26: white-on-black — 0.7s
  const out1 = path.join(TMP, 'e_card_wob.mp4');
  await makeTitleCardClip({ text: 'E2E Test Hook', durationSeconds: 0.7, outputPath: out1, format: '9:16', style: 'white-on-black' });
  const dur1 = await probe(out1);
  ok('E26 Title card (white-on-black): duration ≈ 0.7s', Math.abs(dur1 - 0.7) < 0.2, `got ${dur1.toFixed(3)}s`);

  // E27: accent style — 1s
  const out2 = path.join(TMP, 'e_card_accent.mp4');
  await makeTitleCardClip({ text: 'Никто не говорит об этом:', durationSeconds: 1, outputPath: out2, format: '9:16', style: 'accent' });
  const { w, h } = await probeResolution(out2);
  ok('E27 Title card (accent): resolution = 1080×1920', w === 1080 && h === 1920, `got ${w}×${h}`);

  // E28: can be prepended as first scene in assembleFromClips
  const { assembleFromClips } = await import('../services/video-assembler.js');
  const sceneClip = path.join(TMP, 'e_scene.mp4');
  await makeTestClip(sceneClip, 5, 1080, 1920, 'purple');
  const outWithCard = path.join(TMP, 'e_with_card.mp4');
  const tempCard = path.join(TMP, 'e_card_tmp');
  const durations = await assembleFromClips({
    scenes: [
      { clipPath: out1, duration: 0.7 },   // title card as scene 0
      { clipPath: sceneClip, duration: 5 }, // real scene
    ],
    outputPath: outWithCard,
    tempDir: tempCard,
    format: '9:16',
  });
  const total = await probe(outWithCard);
  ok('E28 Title card prepended to assembly: total duration ≈ 5.7s', Math.abs(total - 5.7) < 0.5, `got ${total.toFixed(3)}s`);
}

// ── F: Full viral pipeline e2e ────────────────────────────────────────────────

section('F29-F32  Viral pipeline e2e: hook/body/cta roles + subtitle burn');

{
  const { assembleFromClips, burnSubtitles } = await import('../services/video-assembler.js');

  // Create 3 clips for hook / body / cta
  const hookClip = path.join(TMP, 'f_hook.mp4');
  const bodyClip = path.join(TMP, 'f_body.mp4');
  const ctaClip  = path.join(TMP, 'f_cta.mp4');
  await Promise.all([
    makeTestClip(hookClip, 5, 1080, 1920, '0x1a2a4a'),  // dark blue
    makeTestClip(bodyClip, 5, 1080, 1920, 'gray'),
    makeTestClip(ctaClip,  5, 1080, 1920, '0x4a2a1a'),  // dark amber
  ]);

  const outViral = path.join(TMP, 'f_viral.mp4');
  const tmpViral = path.join(TMP, 'f_viral_tmp');

  const scenes = [
    { clipPath: hookClip, duration: 5, role: 'hook' as const, narration: 'Это изменит всё что ты знаешь', text: 'Это изменит всё' },
    { clipPath: bodyClip, duration: 5, role: 'body' as const, narration: 'Секрет в одной настройке которую все игнорируют', text: 'Секрет раскрыт' },
    { clipPath: ctaClip,  duration: 5, role: 'cta' as const,  narration: 'Напиши ДА в комментах если хочешь гайд', text: 'Пиши ДА' },
  ];

  const actualDurations = await assembleFromClips({
    scenes,
    outputPath: outViral,
    tempDir: tmpViral,
    format: '9:16',
    flashCut: true,
  });

  // F29: file created
  let exists = false;
  try { await fs.access(outViral); exists = true; } catch {}
  ok('F29 Viral pipeline: assembled MP4 created', exists);

  // F30: resolution 1080×1920
  const { w, h } = await probeResolution(outViral);
  ok('F30 Viral pipeline: resolution = 1080×1920', w === 1080 && h === 1920, `got ${w}×${h}`);

  // F31: burn karaoke subtitles — file should still be valid after burn
  await burnSubtitles({
    videoPath: outViral,
    scenes,
    format: '9:16',
    style: 'tiktok',
    actualDurations,
  });
  const durAfterSubs = await probe(outViral);
  ok('F31 Subtitle burn: video still valid after tiktok subtitle burn', durAfterSubs > 10,
    `dur=${durAfterSubs.toFixed(3)}s`);

  // F32: burn word-timed subtitles with synthetic timestamps
  const wordTimestamps = [
    [{ word: 'Это', start: 0.0, end: 0.3 }, { word: 'изменит', start: 0.35, end: 0.8 }, { word: 'всё', start: 0.85, end: 1.1 }],
    [{ word: 'Секрет', start: 0.0, end: 0.4 }, { word: 'раскрыт', start: 0.45, end: 0.9 }],
    [{ word: 'Пиши', start: 0.0, end: 0.3 }, { word: 'ДА', start: 0.35, end: 0.6 }],
  ];
  await burnSubtitles({
    videoPath: outViral,
    scenes,
    format: '9:16',
    style: 'word-timed',
    actualDurations,
    wordTimestamps,
  });
  const durAfterWordTimed = await probe(outViral);
  ok('F32 word-timed subtitle burn: video still valid', durAfterWordTimed > 10,
    `dur=${durAfterWordTimed.toFixed(3)}s`);
}

// ── G: Input validation (HTTP) ────────────────────────────────────────────────

section('G33-G38  Input validation: length limits + selectedVariant range');

{
  // G33: topic > 500 chars → 400
  const longTopic = 'А'.repeat(501);
  const r1 = await apiPost('/videos', { topic: longTopic, format: '9:16', duration: 15 });
  ok('G33 POST /videos topic>500 chars → 400', r1.status === 400, `got ${r1.status}: ${r1.body?.error}`);

  // G34: topic exactly 500 chars → 201 (boundary OK)
  const exactTopic = 'Б'.repeat(500);
  const r2 = await apiPost('/videos', { topic: exactTopic, format: '9:16', duration: 15 });
  ok('G34 POST /videos topic=500 chars → 201 (boundary OK)', r2.status === 201, `got ${r2.status}`);
  if (r2.body?.id) await apiDelete(`/videos/${r2.body.id}`);

  // G35: customScenario > 5000 chars → 400
  const longScenario = 'В '.repeat(2501);  // 5002 chars
  const r3 = await apiPost('/videos', { customScenario: longScenario, format: '9:16', duration: 15 });
  ok('G35 POST /videos customScenario>5000 chars → 400', r3.status === 400, `got ${r3.status}: ${r3.body?.error}`);

  // G36: additionalDetails > 1000 chars → 400
  const longDetails = 'Г'.repeat(1001);
  const r4 = await apiPost('/videos', { topic: 'test', additionalDetails: longDetails, format: '9:16', duration: 15 });
  ok('G36 POST /videos additionalDetails>1000 chars → 400', r4.status === 400, `got ${r4.status}: ${r4.body?.error}`);

  // G37: PATCH scene selectedVariant=-1 → 400
  if (createdId) {
    const r5 = await apiPatch(`/videos/${createdId}/scenes/fakeid`, { selectedVariant: -1 });
    ok('G37 PATCH scene selectedVariant=-1 → 400', r5.status === 400, `got ${r5.status}: ${r5.body?.error}`);
  } else {
    ok('G37 PATCH scene selectedVariant=-1 → 400', false, 'no project id');
  }

  // G38: PATCH scene selectedVariant=1.5 → 400
  if (createdId) {
    const r6 = await apiPatch(`/videos/${createdId}/scenes/fakeid`, { selectedVariant: 1.5 });
    ok('G38 PATCH scene selectedVariant=1.5 (float) → 400', r6.status === 400, `got ${r6.status}: ${r6.body?.error}`);
  } else {
    ok('G38 PATCH scene selectedVariant=1.5 (float) → 400', false, 'no project id');
  }
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

// Delete created test project
if (createdId) {
  try {
    await apiDelete(`/videos/${createdId}`);
    console.log(`\n  🗑  Deleted test project ${createdId}`);
  } catch {}
}

// Remove temp dir
await fs.rm(TMP, { recursive: true, force: true }).catch(() => {});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(54));
console.log(`E2E tests: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.error('Failed:', failures.join(', '));
  process.exit(1);
} else {
  console.log('All E2E tests passed ✅');
}
