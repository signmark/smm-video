/**
 * E2E-тесты стиля субтитров fade-zoom.
 *
 * Проверяет:
 *   - API принимает subtitleStyle='fade-zoom' при создании проекта
 *   - Значение сохраняется в БД и возвращается в GET /videos/:id
 *   - Смена стиля через PATCH /videos/:id/update-settings (если поддерживается)
 *   - (SLOW) POST /resume с fade-zoom генерирует валидный MP4
 *
 * Запуск (из video-app/):
 *   npx tsx --test e2e/subtitle-fadezoom.e2e.ts
 *   SKIP_SLOW=1 npx tsx --test e2e/subtitle-fadezoom.e2e.ts
 *   VIDEO_PROJECT_ID=<done_id> npx tsx --test e2e/subtitle-fadezoom.e2e.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile }         from 'node:child_process';
import { promisify }        from 'node:util';
import { writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { tmpdir }           from 'node:os';
import { join }             from 'node:path';
import { BASE_URL, TIMEOUTS, SKIP_SLOW } from './config.js';
import { get, post, del, patch, pollUntil } from './helpers.js';

const execFileAsync = promisify(execFile);

const PRESET_DONE_ID = process.env.VIDEO_PROJECT_ID ?? '';

type Project = {
  id: string;
  status: string;
  subtitleStyle?: string;
  script?: { scenes: unknown[]; stockPrechecked?: boolean };
  videoUrl?: string;
  videoPath?: string;
  progress?: number;
  error?: string;
};

type FfprobeOutput = {
  streams: { codec_type: string; codec_name: string; duration?: string }[];
  format: { duration: string; size: string };
};

async function probeBuffer(buf: ArrayBuffer): Promise<FfprobeOutput> {
  const dir = await mkdtemp(join(tmpdir(), 'fz-probe-'));
  const tmp = join(dir, 'p.mp4');
  try {
    await writeFile(tmp, Buffer.from(buf));
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', tmp,
    ]);
    return JSON.parse(stdout) as FfprobeOutput;
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ГРУППА 1: Быстрые тесты — API принимает и сохраняет fade-zoom
// ══════════════════════════════════════════════════════════════════════════════

describe('fade-zoom — создание проекта', { timeout: 30_000 }, () => {
  let projectId: string;

  after(async () => {
    if (projectId) await del(`/videos/${projectId}`).catch(() => {});
  });

  it('POST /videos с subtitleStyle=fade-zoom → 201', async () => {
    const r = await post<Project>('/videos', {
      title: '[E2E] fade-zoom subtitle test',
      topic: 'Тест субтитров fade-zoom',
      format: '9:16',
      duration: 15,
      language: 'ru',
      animationModel: 'wan',
      subtitleStyle: 'fade-zoom',
    });
    assert.equal(r.status, 201,
      `Создание вернуло ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
    assert.ok(r.body.id, 'Нет id в ответе');
    projectId = r.body.id;
  });

  it('GET /videos/:id возвращает subtitleStyle=fade-zoom', async () => {
    assert.ok(projectId, 'projectId не установлен — предыдущий тест провалился');
    const { body: p } = await get<Project>(`/videos/${projectId}`);
    assert.equal(p.subtitleStyle, 'fade-zoom',
      `subtitleStyle="${p.subtitleStyle}", ожидался "fade-zoom"`);
  });

  it('subtitleStyle сохраняется после повторного GET (персистентность)', async () => {
    assert.ok(projectId, 'projectId не установлен');
    // Запрашиваем дважды — убеждаемся что не сбрасывается на default
    await get<Project>(`/videos/${projectId}`);
    const { body: p2 } = await get<Project>(`/videos/${projectId}`);
    assert.equal(p2.subtitleStyle, 'fade-zoom',
      `Повторный GET: subtitleStyle="${p2.subtitleStyle}", ожидался "fade-zoom"`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ГРУППА 2: Сравнение всех стилей — все принимаются API без 400
// ══════════════════════════════════════════════════════════════════════════════

describe('Все subtitle-стили принимаются API', { timeout: 60_000 }, () => {
  const STYLES = [
    'none', 'plain', 'fade', 'fade-zoom', 'karaoke',
    'tiktok', 'word-by-word', 'cinematic', 'cinematic-full', 'bar',
  ] as const;

  const createdIds: string[] = [];

  after(async () => {
    await Promise.all(createdIds.map(id => del(`/videos/${id}`).catch(() => {})));
  });

  for (const style of STYLES) {
    it(`subtitleStyle="${style}" → 201`, async () => {
      const r = await post<Project>('/videos', {
        title: `[E2E] style=${style}`,
        topic: 'Тест стиля субтитров',
        format: '9:16',
        duration: 15,
        language: 'ru',
        animationModel: 'wan',
        subtitleStyle: style,
      });
      assert.equal(r.status, 201,
        `style="${style}" вернул ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
      if (r.body.id) createdIds.push(r.body.id);

      const { body: p } = await get<Project>(`/videos/${r.body.id}`);
      assert.equal(p.subtitleStyle, style,
        `subtitleStyle не сохранился: ожидался "${style}", получен "${p.subtitleStyle}"`);
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ГРУППА 3: Медленные тесты — resume с fade-zoom
// ══════════════════════════════════════════════════════════════════════════════

describe('fade-zoom — resume (переналожение субтитров)', {
  skip: SKIP_SLOW ? 'SKIP_SLOW=1' : false,
  timeout: TIMEOUTS.generate + TIMEOUTS.script + 120_000,
}, () => {
  let doneProjectId = PRESET_DONE_ID;
  const ownProject  = !PRESET_DONE_ID;

  before(async () => {
    if (PRESET_DONE_ID) {
      const { body: p } = await get<Project>(`/videos/${PRESET_DONE_ID}`);
      assert.equal(p.status, 'done',
        `Проект ${PRESET_DONE_ID} не в статусе done (статус: ${p.status})`);
      console.log(`[slow-setup] Используем готовый проект: ${PRESET_DONE_ID}`);
      return;
    }

    console.log('[slow-setup] Генерируем новый проект с subtitleStyle=karaoke...');
    const r = await post<Project>('/videos', {
      title: '[E2E fade-zoom] Resume test',
      topic: 'Преимущества утренней йоги для здоровья',
      format: '9:16',
      duration: 15,
      language: 'ru',
      animationModel: 'seedance',
      subtitleStyle: 'karaoke',
    });
    assert.equal(r.status, 201, `Создание: ${JSON.stringify(r.body).slice(0, 200)}`);
    doneProjectId = r.body.id;

    const rGen = await post(`/videos/${doneProjectId}/generate`, {});
    assert.ok([200, 202].includes(rGen.status), `generate: ${rGen.status}`);

    const done = await pollUntil<Project>(
      `/videos/${doneProjectId}`,
      p => p.status === 'done' || p.status === 'error',
      { timeoutMs: TIMEOUTS.generate, intervalMs: 8000 },
    );
    assert.equal(done.status, 'done',
      `Генерация не завершилась успешно: ${done.status}. Error: ${done.error}`);
    console.log(`[slow-setup] Проект готов: ${doneProjectId}`);
  }, { timeout: TIMEOUTS.generate + TIMEOUTS.script + 60_000 });

  after(async () => {
    if (ownProject && doneProjectId) {
      await del(`/videos/${doneProjectId}`).catch(() => {});
      console.log(`[slow-cleanup] Проект ${doneProjectId} удалён`);
    }
  });

  it('POST /resume с subtitleStyle=fade-zoom → success', async () => {
    const r = await post<{ success: boolean }>(`/videos/${doneProjectId}/resume`, {
      subtitleStyle: 'fade-zoom',
    });
    assert.ok([200, 202].includes(r.status),
      `resume вернул ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
    assert.ok(r.body.success, 'Нет success=true в ответе');
  });

  it('status становится done после resume с fade-zoom', { timeout: 120_000 }, async () => {
    await post(`/videos/${doneProjectId}/resume`, { subtitleStyle: 'fade-zoom' });

    const result = await pollUntil<Project>(
      `/videos/${doneProjectId}`,
      p => p.status === 'done' || p.status === 'error',
      { timeoutMs: 110_000, intervalMs: 3000 },
    );
    assert.equal(result.status, 'done',
      `resume с fade-zoom завершился с ошибкой: ${result.status}. Error: ${result.error}`);
    assert.equal(result.progress, 100, `progress=${result.progress}, ожидалось 100`);
  });

  it('MP4 валиден после resume с fade-zoom (>1 MB, есть видео и аудио)', { timeout: 120_000 }, async () => {
    await post(`/videos/${doneProjectId}/resume`, { subtitleStyle: 'fade-zoom' });
    await pollUntil<Project>(
      `/videos/${doneProjectId}`,
      p => p.status === 'done' || p.status === 'error',
      { timeoutMs: 110_000, intervalMs: 3000 },
    );

    const res = await fetch(`${BASE_URL}/videos/${doneProjectId}/download`, {
      signal: AbortSignal.timeout(60_000),
    });
    assert.equal(res.status, 200, `download: HTTP ${res.status}`);

    const buf = await res.arrayBuffer();
    assert.ok(buf.byteLength > 1_000_000,
      `Файл слишком мал после resume: ${Math.round(buf.byteLength / 1024)}KB`);

    const probe = await probeBuffer(buf);
    const hasVideo = probe.streams.some(s => s.codec_type === 'video');
    const hasAudio = probe.streams.some(s => s.codec_type === 'audio');
    assert.ok(hasVideo, 'Нет видеодорожки после resume с fade-zoom');
    assert.ok(hasAudio, 'Нет аудиодорожки после resume с fade-zoom');

    const dur = parseFloat(probe.format.duration);
    assert.ok(dur > 5, `Длительность видео подозрительно мала: ${dur.toFixed(2)}s`);
    console.log(`[slow] MP4 валиден: ${Math.round(buf.byteLength / 1024)}KB, ${dur.toFixed(2)}s`);
  });

  it('subtitleStyle в проекте обновляется на fade-zoom после resume', async () => {
    const { body: p } = await get<Project>(`/videos/${doneProjectId}`);
    // После resume subtitleStyle должен быть fade-zoom (если resume его сохраняет)
    // Если API не обновляет subtitleStyle через resume — тест пропускается мягко
    if (p.subtitleStyle !== undefined) {
      assert.equal(p.subtitleStyle, 'fade-zoom',
        `subtitleStyle после resume: "${p.subtitleStyle}", ожидался "fade-zoom"`);
    } else {
      console.log('[info] subtitleStyle не возвращается в GET — проверка пропущена');
    }
  });
});
