/**
 * Pipeline integration tests — второй набор, дополняет assembly-test.ts.
 *
 * Группы:
 *  A  Чистые функции (без ffmpeg, мгновенно)
 *  B  Форматы 16:9 и 1:1 — нормализация разрешения
 *  C  Edge-cases сборки (нет аудио, тихая сцена, несколько форматов)
 *  D  mixBackgroundMusic, extractLastFrame, probeActualDuration на битом файле
 *  E  DB CRUD (против реального бэкенда — Directus / PG / JSON)
 *
 * Запуск: cd video-app && npx tsx server/tests/pipeline-test.ts
 */

import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

import {
  probeActualDuration,
  makeStaticClipFromImage,
  assembleFromClips,
  burnSubtitles,
  mixBackgroundMusic,
  extractLastFrame,
  subtitleSizeMultiplier,
} from '../services/video-assembler.js';

import { getMusicStyle, buildMusicPrompt } from '../services/music-generator.js';
import { DATA_PATHS } from '../db.js';
import {
  createProject,
  getProject,
  updateProject,
  deleteProject,
  listProjects,
} from '../db.js';

const execFileAsync = promisify(execFile);

// ── helpers ───────────────────────────────────────────────────────────────────

function ffmpegBin(): string {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return 'ffmpeg'; } catch {}
  try { return (require('@ffmpeg-installer/ffmpeg') as { path: string }).path; } catch {}
  return 'ffmpeg';
}
const FF = ffmpegBin();
const FFPROBE = FF === 'ffmpeg' ? 'ffprobe' : FF.replace(/ffmpeg([^/]*)$/, 'ffprobe$1');

async function mkClip(out: string, dur: number, color: string, w = 270, h = 480): Promise<void> {
  await execFileAsync(FF, [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=${color}:s=${w}x${h}:rate=25`,
    '-t', String(dur),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '51', '-pix_fmt', 'yuv420p',
    out,
  ], { timeout: 30_000 });
}

async function mkClipWithAudio(out: string, dur: number, color: string, w = 270, h = 480): Promise<void> {
  await execFileAsync(FF, [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=${color}:s=${w}x${h}:rate=25`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${dur}`,
    '-t', String(dur),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '51', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '64k',
    out,
  ], { timeout: 30_000 });
}

async function mkAudio(out: string, dur: number): Promise<void> {
  await execFileAsync(FF, [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${dur}`,
    '-c:a', 'mp3', '-b:a', '64k',
    out,
  ], { timeout: 15_000 });
}

async function mkJpeg(out: string, w = 270, h = 480, color = 'blue'): Promise<void> {
  await execFileAsync(FF, [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=${color}:s=${w}x${h}`,
    '-frames:v', '1', out,
  ], { timeout: 10_000 });
}

async function probeRes(file: string): Promise<{ w: number; h: number }> {
  const { stdout } = await execFileAsync(FFPROBE, [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0', file,
  ], { timeout: 10_000 });
  const [w, h] = stdout.trim().split(',').map(Number);
  return { w, h };
}

async function hasAudioStream(file: string): Promise<boolean> {
  const { stdout } = await execFileAsync(FFPROBE, [
    '-v', 'error', '-select_streams', 'a',
    '-show_entries', 'stream=index',
    '-of', 'csv=p=0', file,
  ], { timeout: 10_000 });
  return stdout.trim().length > 0;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

let passed = 0;
let failed = 0;
const createdProjectIds: string[] = [];

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

// ═══════════════════════════════════════════════════════════════════════════════
async function run(): Promise<void> {
  console.log('\n🔬 Video Pipeline Integration Tests\n');

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'pipeline-test-'));
  console.log(`  Working dir: ${tmp}\n`);

  try {

    // ── Group A: Pure functions ──────────────────────────────────────────────
    console.log('── A: Чистые функции ──────────────────────────────────────');

    await test('A01 subtitleSizeMultiplier — все варианты', async () => {
      assert(subtitleSizeMultiplier('small')  === 0.75, 'small ≠ 0.75');
      assert(subtitleSizeMultiplier('medium') === 1.0,  'medium ≠ 1.0');
      assert(subtitleSizeMultiplier('large')  === 1.3,  'large ≠ 1.3');
      assert(subtitleSizeMultiplier('xlarge') === 1.6,  'xlarge ≠ 1.6');
      assert(subtitleSizeMultiplier()         === 1.0,  'undefined ≠ 1.0 (default)');
      assert(subtitleSizeMultiplier('bogus')  === 1.0,  'неизвестное ≠ 1.0 (fallback)');
    });

    await test('A02 buildMusicPrompt — содержит тему, не пустой', async () => {
      const topic = 'умные часы Apple Watch Ultra';
      const prompt = buildMusicPrompt(topic);
      assert(prompt.length > 10, `Слишком короткий: "${prompt}"`);
      assert(prompt.toLowerCase().includes(topic.slice(0, 10).toLowerCase()),
        `Тема не попала в промпт: "${prompt}"`);
    });

    await test('A03 buildMusicPrompt — обрезает длинный топик до 80 символов', async () => {
      const longTopic = 'а'.repeat(200);
      const prompt = buildMusicPrompt(longTopic);
      // The topic in the prompt should be at most 80 chars
      const match = prompt.match(/"([^"]+)"/);
      assert(!!match, 'Промпт не содержит кавычек вокруг темы');
      assert(match![1].length <= 80, `Тема в промпте: ${match![1].length} chars > 80`);
    });

    await test('A04 getMusicStyle — известный стиль возвращает правильный объект', async () => {
      // Valid values: 'none' | 'ambient' | 'cinematic' | 'corporate' | 'electronic' | 'acoustic' | 'jazz'
      const s = getMusicStyle('cinematic');
      assert(s.value === 'cinematic', `Ожидалось value='cinematic', получено '${s.value}'`);
      assert(typeof s.label === 'string' && s.label.length > 0, 'Нет label');
      assert(typeof s.falPrompt === 'string' && s.falPrompt.length > 0, 'Нет falPrompt');
    });

    await test('A05 getMusicStyle — неизвестный стиль → fallback (ambient, index 1)', async () => {
      const s = getMusicStyle('nonexistent_style_xyz');
      assert(typeof s.value === 'string', 'fallback не вернул объект');
      assert(s.value === 'ambient', `fallback должен быть 'ambient', получено '${s.value}'`);
      assert(typeof s.falPrompt === 'string' && s.falPrompt.length > 0, 'у fallback нет falPrompt');
    });

    await test('A06 DATA_PATHS — пути содержат projectId и правильные директории', async () => {
      const pid = 'test-proj-123';
      const imgDir  = DATA_PATHS.imagesDir(pid);
      const vidFile = DATA_PATHS.videoFile(pid);
      assert(imgDir.includes(pid),         `imagesDir не содержит id: ${imgDir}`);
      assert(imgDir.includes('images'),     `imagesDir не содержит 'images': ${imgDir}`);
      assert(vidFile.includes(pid),         `videoFile не содержит id: ${vidFile}`);
      assert(vidFile.endsWith('.mp4'),       `videoFile не .mp4: ${vidFile}`);
      assert(vidFile.includes('videos'),    `videoFile не в директории 'videos': ${vidFile}`);
    });

    // ── Group B: Format normalization ────────────────────────────────────────
    console.log('\n── B: Нормализация форматов ────────────────────────────────');

    process.stdout.write('  Создаю тестовые клипы...');
    const clip270 = path.join(tmp, 'src_270x480.mp4');
    await mkClip(clip270, 3, 'red', 270, 480);
    console.log(' готово\n');

    await test('B07 Формат 16:9 → выход 1920×1080', async () => {
      const clip = path.join(tmp, 'src_270x480_16.mp4');
      await mkClip(clip, 3, 'blue', 270, 480);
      const out = path.join(tmp, 'out_16x9.mp4');
      await assembleFromClips({
        scenes: [{ clipPath: clip, duration: 3, narration: 'test', text: 'test' }],
        outputPath: out,
        tempDir: path.join(tmp, '_asm_16x9'),
        format: '16:9',
      });
      const { w, h } = await probeRes(out);
      assert(w === 1920 && h === 1080, `Ожидалось 1920×1080, получено ${w}×${h}`);
    });

    await test('B08 Формат 1:1 → выход 1080×1080', async () => {
      const clip = path.join(tmp, 'src_270x480_1x1.mp4');
      await mkClip(clip, 3, 'green', 270, 480);
      const out = path.join(tmp, 'out_1x1.mp4');
      await assembleFromClips({
        scenes: [{ clipPath: clip, duration: 3, narration: 'test', text: 'test' }],
        outputPath: out,
        tempDir: path.join(tmp, '_asm_1x1'),
        format: '1:1',
      });
      const { w, h } = await probeRes(out);
      assert(w === 1080 && h === 1080, `Ожидалось 1080×1080, получено ${w}×${h}`);
    });

    await test('B09 Формат 9:16 → выход 1080×1920 (контроль)', async () => {
      const out = path.join(tmp, 'out_9x16_ctrl.mp4');
      await assembleFromClips({
        scenes: [{ clipPath: clip270, duration: 3, narration: 'test', text: 'test' }],
        outputPath: out,
        tempDir: path.join(tmp, '_asm_9x16'),
        format: '9:16',
      });
      const { w, h } = await probeRes(out);
      assert(w === 1080 && h === 1920, `Ожидалось 1080×1920, получено ${w}×${h}`);
    });

    // ── Group C: Edge cases — assembly ───────────────────────────────────────
    console.log('\n── C: Edge cases — сборка ──────────────────────────────────');

    await test('C10 Тихая сцена (нет audioPath) — собирается без ошибок', async () => {
      const clip = path.join(tmp, 'clip_silent.mp4');
      await mkClip(clip, 5, 'teal');
      const out = path.join(tmp, 'out_silent.mp4');
      const durs = await assembleFromClips({
        // no audioPath field
        scenes: [{ clipPath: clip, duration: 5, narration: 'тихо', text: 'Тихая сцена' }],
        outputPath: out,
        tempDir: path.join(tmp, '_asm_silent'),
        format: '9:16',
      });
      const dur = await probeActualDuration(out);
      assert(dur > 0, 'Выходной файл пуст');
      assert(Math.abs(durs[0] - 5) < 0.5, `actualDurations[0]=${durs[0].toFixed(2)}s, ожидалось ~5s`);
    });

    await test('C11 burnSubtitles с style="none" — файл не трогается', async () => {
      const src = path.join(tmp, 'out_9x16_ctrl.mp4');
      const copy = path.join(tmp, 'out_none_style.mp4');
      await fs.copyFile(src, copy);
      const durBefore = await probeActualDuration(src);
      await burnSubtitles({
        videoPath: copy,
        scenes: [{ narration: 'тест', text: 'Тест', duration: 3 }],
        format: '9:16',
        style: 'none',
      });
      const durAfter = await probeActualDuration(copy);
      // style=none must return immediately without touching the file
      assert(Math.abs(durBefore - durAfter) < 0.1,
        `style=none изменил длительность: ${durBefore.toFixed(2)} → ${durAfter.toFixed(2)}`);
    });

    await test('C12 burnSubtitles с actualDurations отличными от planned — выход корректен', async () => {
      // Create a 9s video, tell burnSubtitles scene durations are 3+3+3 planned but 3.5+2.5+3 actual
      const c1 = path.join(tmp, 'c_ts1.mp4'); await mkClip(c1, 3, 'red');
      const c2 = path.join(tmp, 'c_ts2.mp4'); await mkClip(c2, 3, 'blue');
      const c3 = path.join(tmp, 'c_ts3.mp4'); await mkClip(c3, 3, 'green');
      const a1 = path.join(tmp, 'a_ts1.mp3'); await mkAudio(a1, 2.8);
      const a2 = path.join(tmp, 'a_ts2.mp3'); await mkAudio(a2, 2.8);
      const a3 = path.join(tmp, 'a_ts3.mp3'); await mkAudio(a3, 2.8);
      const out = path.join(tmp, 'out_timing.mp4');
      const actualDurs = await assembleFromClips({
        scenes: [
          { clipPath: c1, audioPath: a1, duration: 3, narration: 'Первый', text: '1' },
          { clipPath: c2, audioPath: a2, duration: 3, narration: 'Второй', text: '2' },
          { clipPath: c3, audioPath: a3, duration: 3, narration: 'Третий', text: '3' },
        ],
        outputPath: out,
        tempDir: path.join(tmp, '_asm_timing'),
        format: '9:16',
      });
      await burnSubtitles({
        videoPath: out,
        scenes: [
          { narration: 'Первый', text: '1', duration: 3 },
          { narration: 'Второй', text: '2', duration: 3 },
          { narration: 'Третий', text: '3', duration: 3 },
        ],
        format: '9:16',
        style: 'plain',
        actualDurations: actualDurs,
      });
      const dur = await probeActualDuration(out);
      const totalActual = actualDurs.reduce((a, b) => a + b, 0);
      assert(Math.abs(dur - totalActual) < 0.5,
        `После burnSubtitles длина видео изменилась: было ~${totalActual.toFixed(2)}s, стало ${dur.toFixed(2)}s`);
    });

    // ── Group D: mixBackgroundMusic, extractLastFrame, probeActualDuration ───
    console.log('\n── D: mixBackgroundMusic / extractLastFrame / probe ────────');

    await test('D13 probeActualDuration на несуществующем файле → 0', async () => {
      const dur = await probeActualDuration('/tmp/nonexistent_file_xyz.mp4');
      assert(dur === 0, `Ожидалось 0, получено ${dur}`);
    });

    await test('D14 extractLastFrame — возвращает Buffer, сохраняет JPEG', async () => {
      const clip = path.join(tmp, 'clip_for_frame.mp4');
      await mkClip(clip, 3, 'purple');
      const framePath = path.join(tmp, 'last_frame.jpg');
      const buf = await extractLastFrame(clip, framePath);
      assert(Buffer.isBuffer(buf) && buf.length > 0, 'extractLastFrame вернул пустой buffer');
      const stat = await fs.stat(framePath);
      assert(stat.size > 0, 'JPEG файл пустой');
      // JPEG magic bytes: FF D8
      assert(buf[0] === 0xFF && buf[1] === 0xD8, 'Не JPEG: неверные magic bytes');
    });

    await test('D15 mixBackgroundMusic — длительность не меняется, аудио присутствует', async () => {
      // Build a short video WITH audio (amix needs a voice track to mix into)
      const videoWithAudio = path.join(tmp, 'video_with_audio.mp4');
      await mkClipWithAudio(videoWithAudio, 5, 'orange');
      const musicPath = path.join(tmp, 'music.mp3');
      await mkAudio(musicPath, 10); // longer music — duration=first trims it

      const durBefore = await probeActualDuration(videoWithAudio);
      await mixBackgroundMusic({ videoPath: videoWithAudio, musicPath, musicVolume: 0.15 });
      const durAfter = await probeActualDuration(videoWithAudio);

      assert(Math.abs(durBefore - durAfter) < 0.3,
        `mixBackgroundMusic изменил длину: ${durBefore.toFixed(2)} → ${durAfter.toFixed(2)}`);
      const hasAudio = await hasAudioStream(videoWithAudio);
      assert(hasAudio, 'После microBackgroundMusic нет аудио-потока');
    });

    await test('D16 mixBackgroundMusic — молча пропускает при битом музыкальном файле', async () => {
      const vid = path.join(tmp, 'vid_for_bad_music.mp4');
      await mkClipWithAudio(vid, 3, 'cyan');
      const durBefore = await probeActualDuration(vid);

      // Pass a non-existent music file — should not throw, just warn and skip
      await mixBackgroundMusic({ videoPath: vid, musicPath: '/tmp/no_such_music.mp3' });

      const durAfter = await probeActualDuration(vid);
      assert(Math.abs(durBefore - durAfter) < 0.1,
        `После failed mix видео изменилось: ${durBefore.toFixed(2)} → ${durAfter.toFixed(2)}`);
    });

    await test('D17 makeStaticClipFromImage — JPEG разных размеров → 9:16 выход', async () => {
      // Small JPEG (270×480) → static clip should preserve input size (no forced scaling in makeStatic)
      const jpeg = path.join(tmp, 'small_frame.jpg');
      await mkJpeg(jpeg, 270, 480, 'magenta');
      const out = path.join(tmp, 'static_from_small.mp4');
      await makeStaticClipFromImage({ imagePath: jpeg, durationSeconds: 4, outputPath: out });
      const dur = await probeActualDuration(out);
      assert(Math.abs(dur - 4) < 0.3, `Ожидалось ~4s, получено ${dur.toFixed(3)}s`);
      // After assembleFromClips with format 9:16, it would get scaled — here just check it's a valid video
      const { w, h } = await probeRes(out);
      assert(w > 0 && h > 0, `Некорректное разрешение: ${w}×${h}`);
    });

    // ── Group E: DB CRUD ─────────────────────────────────────────────────────
    console.log('\n── E: DB CRUD ──────────────────────────────────────────────');

    let testProjectId = '';

    await test('E18 createProject — поля сохраняются корректно', async () => {
      const proj = await createProject({
        title: '[TEST] Pipeline test project',
        topic: 'тестирование pipeline',
        format: '9:16',
        duration: 30,
        language: 'ru',
        animationModel: 'wan',
        subtitleStyle: 'plain',
      });
      createdProjectIds.push(proj.id);
      testProjectId = proj.id;
      assert(proj.id.length > 0,          'Нет id');
      assert(proj.title === '[TEST] Pipeline test project', 'title не сохранился');
      assert(proj.format === '9:16',       'format не сохранился');
      assert(proj.status === 'idle',       `status должен быть 'idle', получено '${proj.status}'`);
      assert(proj.progress === 0,          `progress должен быть 0, получено ${proj.progress}`);
      assert(proj.animationModel === 'wan','animationModel не сохранился');
    });

    await test('E19 getProject — round-trip, данные совпадают', async () => {
      assert(testProjectId !== '', 'E18 не прошёл, нет testProjectId');
      const got = await getProject(testProjectId);
      assert(got !== null,                 'getProject вернул null');
      assert(got!.id === testProjectId,    `id не совпадает: ${got!.id}`);
      assert(got!.title === '[TEST] Pipeline test project', 'title не совпадает');
      assert(got!.topic === 'тестирование pipeline', 'topic не совпадает');
    });

    await test('E20 listProjects — включает созданный проект', async () => {
      assert(testProjectId !== '', 'E18 не прошёл');
      const list = await listProjects();
      const found = list.find((p) => p.id === testProjectId);
      assert(!!found, `Проект ${testProjectId} не найден в listProjects`);
    });

    await test('E21 updateProject — частичное обновление, остальные поля не трогаются', async () => {
      assert(testProjectId !== '', 'E18 не прошёл');
      const updated = await updateProject(testProjectId, {
        status: 'animating',
        progress: 42,
        progressMessage: 'Анимирую сцены...',
      });
      assert(updated !== null,               'updateProject вернул null');
      assert(updated!.status === 'animating',`status: ожидалось 'animating', получено '${updated!.status}'`);
      assert(updated!.progress === 42,       `progress: ожидалось 42, получено ${updated!.progress}`);
      // Fields NOT updated must remain
      assert(updated!.format === '9:16',     `format изменился: ${updated!.format}`);
      assert(updated!.topic === 'тестирование pipeline', 'topic изменился');
    });

    await test('E22 updateProject — сохраняет script (JSON)', async () => {
      assert(testProjectId !== '', 'E18 не прошёл');
      const script = {
        title: 'Тестовый сценарий',
        scenes: [
          { id: 'sc1', text: 'Первая сцена', imagePrompt: 'test', duration: 5 },
        ],
      };
      await updateProject(testProjectId, { script: script as any });
      const got = await getProject(testProjectId);
      assert(got?.script !== undefined,     'script не сохранился');
      assert(got!.script!.title === 'Тестовый сценарий', 'script.title не совпадает');
      assert(got!.script!.scenes.length === 1, 'script.scenes не совпадает');
    });

    await test('E23 deleteProject — удаляет проект', async () => {
      if (!testProjectId) { throw new Error('E18 не прошёл, нет testProjectId'); }
      const result = await deleteProject(testProjectId);
      assert(result === true, `deleteProject вернул ${result}, ожидалось true`);
      const gone = await getProject(testProjectId);
      assert(gone === null, 'Проект не был удалён (getProject всё ещё возвращает данные)');
      // Remove from cleanup list (already deleted)
      const idx = createdProjectIds.indexOf(testProjectId);
      if (idx !== -1) createdProjectIds.splice(idx, 1);
    });

    await test('E24 deleteProject — false для несуществующего id', async () => {
      const result = await deleteProject('nonexistent-id-xyz-000');
      assert(result === false, `Ожидалось false, получено ${result}`);
    });

    await test('E25 createProject — уникальные ID при одновременном создании', async () => {
      const projs = await Promise.all([
        createProject({ title: '[TEST] concurrent 1', topic: 't', format: '9:16', duration: 30, language: 'ru' }),
        createProject({ title: '[TEST] concurrent 2', topic: 't', format: '9:16', duration: 30, language: 'ru' }),
        createProject({ title: '[TEST] concurrent 3', topic: 't', format: '9:16', duration: 30, language: 'ru' }),
      ]);
      projs.forEach((p) => createdProjectIds.push(p.id));
      const ids = projs.map((p) => p.id);
      const unique = new Set(ids);
      assert(unique.size === 3, `Дублирующиеся IDs: ${ids.join(', ')}`);
    });

  } finally {
    // ── Cleanup: удаляем тестовые проекты ─────────────────────────────────
    if (createdProjectIds.length > 0) {
      process.stdout.write(`\n  Очистка: удаляю ${createdProjectIds.length} тестовых проектов...`);
      await Promise.allSettled(createdProjectIds.map((id) => deleteProject(id)));
      console.log(' готово');
    }
    await fs.rm(tmp, { recursive: true, force: true });
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(58)}`);
  console.log(`Итого: ${passed + failed} тестов | ✅ ${passed} пройдено | ❌ ${failed} упало`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('\n💥 Тест упал с ошибкой:', err.message);
  process.exit(1);
});
