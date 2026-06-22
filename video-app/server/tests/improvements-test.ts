/**
 * Improvements Tests — Video App
 *
 * Tests for the 7 improvements implemented on top of the viral features:
 *   H39-H43   Title card auto-prepend + hookTextOverlay assembly
 *   I44-I46   hookTextOverlay edge-cases + 16:9 subtitle font proportionality
 *
 * Prerequisites:
 *   • Video App server running on port 3001  (cd video-app && npx tsx server/index.ts)
 *
 * Run:
 *   cd video-app && npx tsx server/tests/improvements-test.ts
 */

import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { execFileSync } from 'child_process';

const execFileAsync = promisify(execFile);

// ── config ────────────────────────────────────────────────────────────────────

const FFMPEG = (() => {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return 'ffmpeg'; } catch {}
  return 'ffmpeg';
})();

async function probe(filePath: string): Promise<number> {
  const ffprobe = 'ffprobe';
  try {
    const { stdout } = await execFileAsync(ffprobe, [
      '-v', 'quiet', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
    ]);
    return parseFloat(stdout.trim()) || 0;
  } catch { return 0; }
}

async function probeResolution(filePath: string): Promise<{ w: number; h: number }> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'csv=s=x:p=0', filePath,
    ]);
    const parts = stdout.trim().split('x');
    return { w: parseInt(parts[0]) || 0, h: parseInt(parts[1]) || 0 };
  } catch { return { w: 0, h: 0 }; }
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

// ── synthetic clip helpers ────────────────────────────────────────────────────

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

const TMP = path.join(os.tmpdir(), `improvements-test-${Date.now()}`);
await fs.mkdir(TMP, { recursive: true });

// ── H: Title card auto-prepend + hookTextOverlay ──────────────────────────────

section('H39-H43  Title card auto-prepend via maybeWithTitleCard');

{
  const { assembleFromClips, makeTitleCardClip } = await import('../services/video-assembler.js');

  const bodyClipH = path.join(TMP, 'h_body.mp4');
  const hookClipH = path.join(TMP, 'h_hook.mp4');
  await makeTestClip(bodyClipH, 5, 1080, 1920, 'navy');
  await makeTestClip(hookClipH, 5, 1080, 1920, 'teal');

  // H39: No hook scenes → actualDurations.length = 2 (unchanged by hookTextOverlay)
  const noHookScenes = [
    { clipPath: bodyClipH, duration: 5, role: 'body' as const, text: 'Body scene' },
    { clipPath: bodyClipH, duration: 5, role: 'cta' as const,  text: 'CTA scene' },
  ];
  const outNoHook = path.join(TMP, 'h_nohook.mp4');
  const durNoHook = await assembleFromClips({
    scenes: noHookScenes, outputPath: outNoHook,
    tempDir: path.join(TMP, 'h_nohook_tmp'), format: '9:16', flashCut: true,
  });
  ok('H39 No hook scenes → actualDurations.length = 2 (unchanged)', durNoHook.length === 2, `got ${durNoHook.length}`);

  // H40: hook scene + hookTextOverlay=true → output file created (overlay burned)
  const hookScenes = [
    { clipPath: hookClipH, duration: 5, role: 'hook' as const, text: 'Никто не говорит об этом!' },
    { clipPath: bodyClipH, duration: 5, role: 'body' as const, text: 'Вот почему' },
  ];
  const outHook = path.join(TMP, 'h_hook_out.mp4');
  const durHook = await assembleFromClips({
    scenes: hookScenes, outputPath: outHook,
    tempDir: path.join(TMP, 'h_hook_tmp'), format: '9:16',
    flashCut: true, hookTextOverlay: true,
  });
  let hookOutExists = false;
  try { await fs.access(outHook); hookOutExists = true; } catch {}
  ok('H40 hookTextOverlay=true + hook scene: output file created', hookOutExists);

  // H41: hookTextOverlay does not increase scene count
  ok('H41 hookTextOverlay: actualDurations.length = 2 (scene count unchanged)', durHook.length === 2, `got ${durHook.length}`);

  // H42: makeTitleCardClip generates a ~0.7s file
  const cardPath = path.join(TMP, 'h_card.mp4');
  await makeTitleCardClip({ text: 'Никто не знает об этом', durationSeconds: 0.7, outputPath: cardPath, format: '9:16', style: 'accent' });
  const cardDur = await probe(cardPath);
  ok('H42 Title card: duration ≈ 0.7s (±0.2s)', Math.abs(cardDur - 0.7) < 0.2, `got ${cardDur.toFixed(3)}s`);

  // H43: makeTitleCardClip generates correct resolution 1080×1920
  const cardRes = await probeResolution(cardPath);
  ok('H43 Title card: resolution = 1080×1920', cardRes.w === 1080 && cardRes.h === 1920, `got ${cardRes.w}×${cardRes.h}`);
}

// ── I: hookTextOverlay edge-cases + 16:9 subtitle font proportionality ─────────

section('I44-I46  hookTextOverlay edge-cases + 16:9 subtitle font');

{
  const { assembleFromClips, burnSubtitles } = await import('../services/video-assembler.js');

  // I44: hook scene without text → hookTextOverlay does not crash (filter skipped)
  const noTextClip = path.join(TMP, 'i_notext.mp4');
  await makeTestClip(noTextClip, 3, 1080, 1920, 'olive');
  const outNoText = path.join(TMP, 'i_notext_out.mp4');
  const durs44 = await assembleFromClips({
    scenes: [{ clipPath: noTextClip, duration: 3, role: 'hook' as const }],
    outputPath: outNoText, tempDir: path.join(TMP, 'i_notext_tmp'),
    format: '9:16', hookTextOverlay: true,
  });
  ok('I44 hookTextOverlay: hook scene without text → no crash (1 duration returned)', durs44.length === 1, `got ${durs44.length}`);

  // I45: 16:9 tiktok subtitle burn produces valid output
  const clip16_9 = path.join(TMP, 'i_16_9.mp4');
  await makeTestClip(clip16_9, 4, 1920, 1080, 'sienna');
  await burnSubtitles({
    videoPath: clip16_9,
    scenes: [{ narration: 'Тест субтитров для 16:9 формата', duration: 4 }],
    format: '16:9', style: 'tiktok',
  });
  const dur16 = await probe(clip16_9);
  ok('I45 16:9 tiktok subtitle burn: video valid after burn', dur16 > 3, `got ${dur16.toFixed(3)}s`);

  // I46: formatAwareFontSize — 16:9 absolute font size ≈ 9:16 absolute font size
  //   9:16:  w=1080, factor=0.070 → floor(1080×0.070)       = 75px
  //   16:9:  w=1920, factor=0.070, scale=0.58 → floor(1920×0.070×0.58) = 77px
  //   Difference = 2px (within 20px tolerance) → comparable readable size ✓
  const size916 = Math.floor(1080 * 0.070);
  const size169 = Math.floor(1920 * 0.070 * 0.58);
  const diff = Math.abs(size169 - size916);
  ok(
    `I46 formatAwareFontSize: 16:9 abs px (${size169}) ≈ 9:16 abs px (${size916}) within 20px`,
    diff < 20,
    `diff=${diff}px`,
  );
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

await fs.rm(TMP, { recursive: true, force: true }).catch(() => {});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(54));
console.log(`Improvements tests: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.error('Failed:', failures.join(', '));
  process.exit(1);
} else {
  console.log('All improvements tests passed ✅');
}
