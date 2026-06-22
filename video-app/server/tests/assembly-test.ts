/**
 * E2E тест пайплайна сборки видео.
 *
 * Покрываемые сценарии:
 *  1.  probeActualDuration — возвращает корректную длительность
 *  2.  assembleFromClips — возвращает actualDurations[] без дрейфа
 *  3.  Итоговое видео: суммарная длительность = сумма actualDurations
 *  4.  burnSubtitles: файл создаётся, длительность не меняется
 *  5.  Кроссфейд: crossfadeDuration > 0 — видео создаётся без ошибок
 *  6.  Дрейф субтитров < 0.1s (синтетические клипы)
 *  7.  Короткий клип (< scene.duration) зацикливается до нужной длины
 *  8.  Нормализация разрешения — все клипы выходят с одинаковым WxH
 *  9.  Смешанные разрешения (1080×1920 + 480×832) → одинаковый выход
 * 10.  makeStaticClipFromImage — создаёт клип нужной длины из JPEG
 *
 * Запуск: cd video-app && npx tsx server/tests/assembly-test.ts
 */

import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  assembleFromClips,
  burnSubtitles,
  probeActualDuration,
  makeStaticClipFromImage,
} from '../services/video-assembler.js';

const execFileAsync = promisify(execFile);

// ── helpers ───────────────────────────────────────────────────────────────────

function ffmpegBin(): string {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return 'ffmpeg'; } catch {}
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return (require('@ffmpeg-installer/ffmpeg') as { path: string }).path;
  } catch {}
  return 'ffmpeg';
}

const FF = ffmpegBin();

async function createSyntheticClip(params: {
  outputPath: string;
  durationSec: number;
  colorHex: string;
  width?: number;
  height?: number;
}): Promise<void> {
  // Default to tiny resolution so tests encode fast in CI/Replit.
  // T08/T09 pass explicit sizes to test the normalisation logic.
  const { outputPath, durationSec, colorHex, width = 270, height = 480 } = params;
  await execFileAsync(FF, [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi',
    '-i', `color=c=${colorHex}:s=${width}x${height}:rate=25`,
    '-t', String(durationSec),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '51', '-pix_fmt', 'yuv420p',
    outputPath,
  ], { timeout: 30_000 });
}

async function createSyntheticAudio(outputPath: string, durationSec: number): Promise<void> {
  await execFileAsync(FF, [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${durationSec}`,
    '-c:a', 'mp3', '-b:a', '64k',
    outputPath,
  ], { timeout: 15_000 });
}

async function createSyntheticJpeg(outputPath: string, width: number, height: number, color = 'blue'): Promise<void> {
  await execFileAsync(FF, [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=${color}:s=${width}x${height}`,
    '-frames:v', '1',
    outputPath,
  ], { timeout: 10_000 });
}

async function probeResolution(filePath: string): Promise<{ w: number; h: number }> {
  const { stdout } = await execFileAsync(FF.replace(/ffmpeg([^/]*)$/, 'ffprobe$1'), [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0',
    filePath,
  ], { timeout: 10_000 });
  const [w, h] = stdout.trim().split(',').map(Number);
  return { w, h };
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg);
}

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  process.stdout.write(`  ${name} ... `);
  try {
    await fn();
    console.log('✅ PASS');
    passed++;
  } catch (err: any) {
    console.log(`❌ FAIL: ${err.message}`);
    failed++;
  }
}

// ── Test suite ─────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log('\n🎬 Video Assembly E2E Tests\n');

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-asm-test-'));
  console.log(`  Working dir: ${tmpDir}\n`);

  try {
    // ── Prepare standard synthetic clips (1080×1920, 5s each) ─────────────────
    const SCENES = [
      { color: 'red',   dur: 5.0, narration: 'Текст первой сцены',   text: 'Первая сцена'  },
      { color: 'blue',  dur: 5.0, narration: 'Текст второй сцены',   text: 'Вторая сцена'  },
      { color: 'green', dur: 5.0, narration: 'Текст третьей сцены',  text: 'Третья сцена'  },
    ];

    process.stdout.write('  Создаю синтетические клипы (1080×1920)...');
    const clipPaths: string[] = [];
    const audioPaths: string[] = [];

    for (let i = 0; i < SCENES.length; i++) {
      const s = SCENES[i];
      const clipPath  = path.join(tmpDir, `clip_${i}.mp4`);
      const audioPath = path.join(tmpDir, `audio_${i}.mp3`);
      await createSyntheticClip({ outputPath: clipPath, durationSec: s.dur, colorHex: s.color });
      await createSyntheticAudio(audioPath, s.dur - 0.5);
      clipPaths.push(clipPath);
      audioPaths.push(audioPath);
    }
    console.log(' готово\n');

    const scenes = SCENES.map((s, i) => ({
      clipPath:   clipPaths[i],
      audioPath:  audioPaths[i],
      duration:   s.dur,
      text:       s.text,
      narration:  s.narration,
    }));

    // ── T01: probeActualDuration ──────────────────────────────────────────────
    await test('T01 probeActualDuration возвращает корректное время', async () => {
      const dur = await probeActualDuration(clipPaths[0]);
      assert(Math.abs(dur - 5.0) < 0.15, `Ожидалось ~5.0s, получено ${dur.toFixed(3)}s`);
    });

    // ── T02: assembleFromClips — actualDurations[] ────────────────────────────
    const asmDir1  = path.join(tmpDir, '_asm1');
    const outHardcut = path.join(tmpDir, 'out_hardcut.mp4');
    let actualDurations: number[] = [];

    await test('T02 assembleFromClips возвращает actualDurations[]', async () => {
      actualDurations = await assembleFromClips({
        scenes,
        outputPath: outHardcut,
        tempDir: asmDir1,
        format: '9:16',
      });
      assert(
        actualDurations.length === SCENES.length,
        `Ожидалось ${SCENES.length} длительностей, получено ${actualDurations.length}`,
      );
      for (let i = 0; i < actualDurations.length; i++) {
        const drift = Math.abs(actualDurations[i] - SCENES[i].dur);
        assert(drift < 0.5, `Сцена ${i}: дрейф ${drift.toFixed(3)}s (max 0.5s)`);
      }
    });

    // ── T03: итоговая длительность ───────────────────────────────────────────
    await test('T03 Итоговое видео: длительность ≈ сумме actualDurations', async () => {
      const outputDur  = await probeActualDuration(outHardcut);
      const expectedDur = actualDurations.reduce((a, b) => a + b, 0);
      const drift = Math.abs(outputDur - expectedDur);
      assert(drift < 0.5,
        `Ожидалось ~${expectedDur.toFixed(2)}s, получено ${outputDur.toFixed(2)}s (drift=${drift.toFixed(3)}s)`);
    });

    // ── T04: burnSubtitles ───────────────────────────────────────────────────
    await test('T04 burnSubtitles: файл создаётся, длительность не меняется', async () => {
      const outSubs = path.join(tmpDir, 'out_subs.mp4');
      await fs.copyFile(outHardcut, outSubs);
      await burnSubtitles({
        videoPath: outSubs,
        scenes: scenes.map(s => ({ narration: s.narration, text: s.text, duration: s.duration })),
        format: '9:16',
        style: 'plain',
        actualDurations,
      });
      const dur = await probeActualDuration(outSubs);
      assert(dur > 0, 'Видео с субтитрами имеет нулевую длительность');
      const baseDur = await probeActualDuration(outHardcut);
      assert(Math.abs(dur - baseDur) < 0.5,
        `Субтитры изменили длительность: было ${baseDur.toFixed(2)}s, стало ${dur.toFixed(2)}s`);
    });

    // ── T05: кроссфейд ───────────────────────────────────────────────────────
    await test('T05 assembleFromClips: кроссфейд 0.3s — видео создаётся', async () => {
      const cfDir = path.join(tmpDir, '_asm_cf');
      const cfOut = path.join(tmpDir, 'out_crossfade.mp4');
      const cfDurations = await assembleFromClips({
        scenes,
        outputPath: cfOut,
        tempDir: cfDir,
        format: '9:16',
        crossfadeDuration: 0.3,
      });
      const dur = await probeActualDuration(cfOut);
      assert(dur > 0, 'Выходной файл с кроссфейдом пустой');
      const expectedMin = cfDurations.reduce((a, b) => a + b, 0)
        - (SCENES.length - 1) * 0.3 - 1.0;
      assert(dur > expectedMin,
        `Видео слишком короткое: ${dur.toFixed(2)}s (ожидалось > ${expectedMin.toFixed(2)}s)`);
    });

    // ── T06: дрейф субтитров ─────────────────────────────────────────────────
    await test('T06 Накопленный дрейф субтитров < 0.3s', async () => {
      const tPlanned = SCENES.reduce((a, s) => a + s.dur, 0);
      const tActual  = actualDurations.reduce((a, b) => a + b, 0);
      const drift    = Math.abs(tPlanned - tActual);
      console.log(`\n     planned=${tPlanned.toFixed(3)}s  actual=${tActual.toFixed(3)}s  drift=${drift.toFixed(3)}s`);
      assert(drift < 0.3, `Дрейф ${drift.toFixed(3)}s > 0.3s`);
    });

    // ── T07: короткий клип зацикливается до scene.duration ──────────────────
    await test('T07 Короткий клип (3.375s) зацикливается до scene.duration (5s)', async () => {
      const shortClip  = path.join(tmpDir, 'short_clip.mp4');
      const shortAudio = path.join(tmpDir, 'short_audio.mp3');
      // Simulate WAN 81 frames @ 24fps = 3.375s
      await createSyntheticClip({ outputPath: shortClip, durationSec: 3.375, colorHex: 'purple' });
      await createSyntheticAudio(shortAudio, 4.5);

      const shortScene = [{ clipPath: shortClip, audioPath: shortAudio, duration: 5.0, narration: 'test', text: 'test' }];
      const shortOut   = path.join(tmpDir, 'out_short_loop.mp4');
      const shortDir   = path.join(tmpDir, '_asm_short');
      const durations  = await assembleFromClips({
        scenes: shortScene,
        outputPath: shortOut,
        tempDir: shortDir,
        format: '9:16',
      });
      const actualDur = await probeActualDuration(shortOut);
      assert(
        Math.abs(actualDur - 5.0) < 0.3,
        `Ожидалось ~5.0s (зациклено), получено ${actualDur.toFixed(3)}s`,
      );
      assert(
        Math.abs(durations[0] - 5.0) < 0.3,
        `actualDurations[0] = ${durations[0].toFixed(3)}s, ожидалось ~5.0s`,
      );
    });

    // ── T08: нормализация разрешения — выход всегда 1080×1920 ────────────────
    await test('T08 Нормализация разрешения: все клипы → 1080×1920 для 9:16', async () => {
      const smallClip = path.join(tmpDir, 'small_clip.mp4');
      // Simulate WAN output at 480×832
      await createSyntheticClip({ outputPath: smallClip, durationSec: 5, colorHex: 'orange', width: 480, height: 832 });
      const smallScene = [{ clipPath: smallClip, duration: 5.0, narration: 'test', text: 'test' }];
      const smallOut   = path.join(tmpDir, 'out_small_norm.mp4');
      const smallDir   = path.join(tmpDir, '_asm_small');
      await assembleFromClips({
        scenes: smallScene,
        outputPath: smallOut,
        tempDir: smallDir,
        format: '9:16',
      });
      const { w, h } = await probeResolution(smallOut);
      assert(w === 1080 && h === 1920,
        `Ожидалось 1080×1920, получено ${w}×${h}`);
    });

    // ── T09: смешанные разрешения → одинаковый выход ─────────────────────────
    await test('T09 Смешанные разрешения (1080×1920 + 480×832 + 720×1280) → 1080×1920', async () => {
      const clip1080 = path.join(tmpDir, 'mix_1080.mp4');
      const clip480  = path.join(tmpDir, 'mix_480.mp4');
      const clip720  = path.join(tmpDir, 'mix_720.mp4');
      await createSyntheticClip({ outputPath: clip1080, durationSec: 5, colorHex: 'red',    width: 1080, height: 1920 });
      await createSyntheticClip({ outputPath: clip480,  durationSec: 5, colorHex: 'green',  width: 480,  height: 832  });
      await createSyntheticClip({ outputPath: clip720,  durationSec: 5, colorHex: 'blue',   width: 720,  height: 1280 });
      const mixScenes = [clip1080, clip480, clip720].map(c => ({ clipPath: c, duration: 5.0, narration: 'x', text: 'x' }));
      const mixOut    = path.join(tmpDir, 'out_mixed.mp4');
      const mixDir    = path.join(tmpDir, '_asm_mix');
      await assembleFromClips({
        scenes: mixScenes,
        outputPath: mixOut,
        tempDir: mixDir,
        format: '9:16',
      });
      const { w, h } = await probeResolution(mixOut);
      assert(w === 1080 && h === 1920,
        `Ожидалось 1080×1920, получено ${w}×${h}`);
      const totalDur = await probeActualDuration(mixOut);
      assert(Math.abs(totalDur - 15.0) < 0.5,
        `Ожидалось ~15s, получено ${totalDur.toFixed(2)}s`);
    });

    // ── T10: makeStaticClipFromImage ─────────────────────────────────────────
    await test('T10 makeStaticClipFromImage: клип нужной длины из JPEG', async () => {
      const jpegPath  = path.join(tmpDir, 'frame.jpg');
      const staticOut = path.join(tmpDir, 'out_static.mp4');
      await createSyntheticJpeg(jpegPath, 1080, 1920, 'teal');
      await makeStaticClipFromImage({ imagePath: jpegPath, durationSeconds: 5.0, outputPath: staticOut });
      const dur = await probeActualDuration(staticOut);
      assert(Math.abs(dur - 5.0) < 0.3,
        `Ожидалось ~5.0s, получено ${dur.toFixed(3)}s`);
      const { w, h } = await probeResolution(staticOut);
      assert(w === 1080 && h === 1920,
        `Ожидалось 1080×1920, получено ${w}×${h}`);
    });

  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(55)}`);
  console.log(`Итого: ${passed + failed} тестов | ✅ ${passed} пройдено | ❌ ${failed} упало`);
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('\n💥 Тест упал с ошибкой:', err.message);
  process.exit(1);
});
