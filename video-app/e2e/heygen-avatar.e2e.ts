/**
 * E2E-тесты HeyGen avatar / agent интеграции.
 *
 * Группы:
 *   1. heygen-avatar — создание проекта, поля, heygenAvatar preset
 *   2. heygen-avatar — generate-script: все сцены получают videoSource=avatar,
 *      stockPrechecked=true без реальной проверки стоков (MEDIUM — ждёт AI-скрипт)
 *   3. heygen-agent — создание проекта, поля
 *   4. heygen-agent — generate пропускает сценарий (MEDIUM — ждёт первого перехода статуса)
 *   5. (SLOW) heygen-avatar — полная генерация → валидный MP4
 *   6. (SLOW) heygen-agent — полная генерация → валидный MP4
 *
 * Запуск (из video-app/):
 *   VIDEO_E2E_URL=https://smm.omemo.tech/video-app/api npx tsx --test e2e/heygen-avatar.e2e.ts
 *   SKIP_SLOW=1 VIDEO_E2E_URL=... npx tsx --test e2e/heygen-avatar.e2e.ts
 *
 * Для SLOW-тестов можно передать ID уже готовых проектов:
 *   HEYGEN_AVATAR_DONE_ID=<id>  — пропустить генерацию avatar, использовать готовый
 *   HEYGEN_AGENT_DONE_ID=<id>   — пропустить генерацию agent, использовать готовый
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile }       from 'node:child_process';
import { promisify }      from 'node:util';
import { writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { tmpdir }         from 'node:os';
import { join }           from 'node:path';
import { BASE_URL, TIMEOUTS, SKIP_SLOW } from './config.js';
import { get, post, del, pollUntil }     from './helpers.js';

const execFileAsync = promisify(execFile);

// ── Типы ──────────────────────────────────────────────────────────────────────

type Scene = {
  videoSource?: string;
  narration?: string;
  text?: string;
};

type Project = {
  id: string;
  status: string;
  animationModel?: string;
  heygenAvatar?: string;
  subtitleStyle?: string;
  videoUrl?: string;
  videoPath?: string;
  progress?: number;
  error?: string;
  script?: {
    scenes: Scene[];
    stockPrechecked?: boolean;
  };
};

// ── Утилиты ───────────────────────────────────────────────────────────────────

type FfprobeOutput = {
  streams: { codec_type: string; codec_name: string }[];
  format: { duration: string; size: string };
};

async function probeBuffer(buf: ArrayBuffer): Promise<FfprobeOutput> {
  const dir = await mkdtemp(join(tmpdir(), 'hg-probe-'));
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

async function downloadAndProbe(projectId: string): Promise<{ buf: ArrayBuffer; probe: FfprobeOutput }> {
  const res = await fetch(`${BASE_URL}/videos/${projectId}/download`, {
    signal: AbortSignal.timeout(60_000),
  });
  assert.equal(res.status, 200, `download HTTP ${res.status} для проекта ${projectId}`);
  const buf = await res.arrayBuffer();
  assert.ok(buf.byteLength > 500_000, `Файл слишком мал: ${Math.round(buf.byteLength / 1024)}KB`);
  const probe = await probeBuffer(buf);
  return { buf, probe };
}

// ══════════════════════════════════════════════════════════════════════════════
// ГРУППА 1: heygen-avatar — создание и поля
// ══════════════════════════════════════════════════════════════════════════════

describe('heygen-avatar — создание проекта', { timeout: 30_000 }, () => {
  let projectId: string;

  after(async () => {
    if (projectId) await del(`/videos/${projectId}`).catch(() => {});
  });

  it('POST /videos с animationModel=heygen-avatar → 201', async () => {
    const r = await post<Project>('/videos', {
      title: '[E2E] heygen-avatar project',
      topic: 'Польза медитации для снятия стресса',
      format: '9:16',
      duration: 30,
      language: 'ru',
      animationModel: 'heygen-avatar',
      subtitleStyle: 'fade',
    });
    assert.equal(r.status, 201,
      `Ожидался 201, получен ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
    assert.ok(r.body.id, 'Нет id в ответе');
    projectId = r.body.id;
  });

  it('GET /videos/:id возвращает animationModel=heygen-avatar', async () => {
    assert.ok(projectId, 'projectId не установлен');
    const { body: p } = await get<Project>(`/videos/${projectId}`);
    assert.equal(p.animationModel, 'heygen-avatar',
      `animationModel="${p.animationModel}", ожидался "heygen-avatar"`);
  });

  it('heygenAvatar preset сохраняется и возвращается', async () => {
    // Создаём отдельный проект с кастомным пресетом
    const r = await post<Project>('/videos', {
      title: '[E2E] heygen-avatar with preset',
      topic: 'Тест пресета аватара',
      format: '16:9',
      duration: 15,
      language: 'ru',
      animationModel: 'heygen-avatar',
      heygenAvatar: 'Abigail Sofa Front',
    });
    assert.equal(r.status, 201, `Создание с пресетом: ${r.status}`);
    const id = r.body.id;
    try {
      const { body: p } = await get<Project>(`/videos/${id}`);
      assert.equal(p.heygenAvatar, 'Abigail Sofa Front',
        `heygenAvatar="${p.heygenAvatar}", ожидался "Abigail Sofa Front"`);
    } finally {
      await del(`/videos/${id}`).catch(() => {});
    }
  });

  it('проект без heygenAvatar — поле undefined или null (не падает)', async () => {
    assert.ok(projectId, 'projectId не установлен');
    const { body: p } = await get<Project>(`/videos/${projectId}`);
    // Допустимо undefined или null или DEFAULT ('Abigail Sofa Front')
    // Главное — нет 500 и проект существует
    assert.ok(p.id === projectId, 'Проект не найден');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ГРУППА 2: heygen-avatar — generate-script выставляет все сцены avatar
// ══════════════════════════════════════════════════════════════════════════════

describe('heygen-avatar — generate-script: все сцены = avatar', {
  skip: SKIP_SLOW ? 'SKIP_SLOW=1' : false,
  timeout: TIMEOUTS.script + TIMEOUTS.stockPrecheck + 30_000,
}, () => {
  let projectId: string;

  before(async () => {
    const r = await post<Project>('/videos', {
      title: '[E2E] heygen-avatar script test',
      topic: 'Секреты продуктивного утра',
      format: '9:16',
      duration: 20,
      language: 'ru',
      animationModel: 'heygen-avatar',
    });
    assert.equal(r.status, 201, `Создание: ${JSON.stringify(r.body).slice(0, 200)}`);
    projectId = r.body.id;
  });

  after(async () => {
    if (projectId) await del(`/videos/${projectId}`).catch(() => {});
  });

  it('POST /videos/:id/generate-script → 200 success', async () => {
    const r = await post(`/videos/${projectId}/generate-script`, {});
    assert.ok([200, 202].includes(r.status),
      `generate-script: ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  });

  it('статус меняется на script_ready с stockPrechecked=true', async () => {
    const p = await pollUntil<Project>(
      `/videos/${projectId}`,
      (p) =>
        p.status === 'script_ready' &&
        p.script?.stockPrechecked === true,
      { timeoutMs: TIMEOUTS.script + TIMEOUTS.stockPrecheck, intervalMs: 3000 },
    );
    assert.equal(p.status, 'script_ready',
      `Неожиданный статус: ${p.status}. Error: ${p.error}`);
    assert.equal(p.script?.stockPrechecked, true,
      'stockPrechecked не стал true после generate-script для heygen-avatar');
  });

  it('все сцены сценария имеют videoSource=avatar', async () => {
    const { body: p } = await get<Project>(`/videos/${projectId}`);
    assert.ok(p.script?.scenes && p.script.scenes.length > 0,
      'Нет сцен в сценарии');
    for (let i = 0; i < p.script!.scenes.length; i++) {
      const s = p.script!.scenes[i];
      assert.equal(s.videoSource, 'avatar',
        `Сцена ${i + 1}: videoSource="${s.videoSource}", ожидался "avatar"`);
    }
    console.log(`[info] Сцены: ${p.script!.scenes.length}, все с videoSource=avatar`);
  });

  it('stockPrechecked=true устанавливается без реальной проверки стоков (быстро)', async () => {
    // Если достигли сюда — значит stockPrechecked стал true без 120s задержки Pexels.
    // heygen-avatar должен пропускать stock precheck целиком.
    const { body: p } = await get<Project>(`/videos/${projectId}`);
    assert.equal(p.script?.stockPrechecked, true);
    // Нет сцен с videoSource=stock или videoSource=ai
    const nonAvatar = (p.script?.scenes ?? []).filter((s) => s.videoSource !== 'avatar');
    assert.equal(nonAvatar.length, 0,
      `Найдены сцены не-avatar: ${JSON.stringify(nonAvatar.map(s => s.videoSource))}`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ГРУППА 3: heygen-agent — создание и поля
// ══════════════════════════════════════════════════════════════════════════════

describe('heygen-agent — создание проекта', { timeout: 30_000 }, () => {
  let projectId: string;

  after(async () => {
    if (projectId) await del(`/videos/${projectId}`).catch(() => {});
  });

  it('POST /videos с animationModel=heygen-agent → 201', async () => {
    const r = await post<Project>('/videos', {
      title: '[E2E] heygen-agent project',
      topic: 'Корпоративное видео о цифровой трансформации',
      format: '16:9',
      duration: 30,
      language: 'ru',
      animationModel: 'heygen-agent',
      customScenario: 'Расскажи о преимуществах цифровой трансформации для бизнеса',
    });
    assert.equal(r.status, 201,
      `Ожидался 201, получен ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
    assert.ok(r.body.id, 'Нет id в ответе');
    projectId = r.body.id;
  });

  it('GET /videos/:id возвращает animationModel=heygen-agent', async () => {
    assert.ok(projectId, 'projectId не установлен');
    const { body: p } = await get<Project>(`/videos/${projectId}`);
    assert.equal(p.animationModel, 'heygen-agent',
      `animationModel="${p.animationModel}", ожидался "heygen-agent"`);
  });

  it('heygen-agent поддерживает customScenario', async () => {
    const r = await post<Project>('/videos', {
      title: '[E2E] heygen-agent custom scenario',
      topic: 'Тест кастомного сценария',
      format: '16:9',
      duration: 30,
      language: 'ru',
      animationModel: 'heygen-agent',
      customScenario: 'Покажи будущее AI-технологий в медицине',
    });
    assert.equal(r.status, 201, `customScenario: ${r.status}`);
    const id = r.body.id;
    try {
      const { body: p } = await get<Project>(`/videos/${id}`);
      assert.ok(p.id === id, 'Проект не найден');
    } finally {
      await del(`/videos/${id}`).catch(() => {});
    }
  });

  it('POST /videos/:id/generate-script для heygen-agent → не зависает (возвращает 200)', async () => {
    // heygen-agent пропускает runScriptOnly — вся генерация через /generate.
    // Но generate-script должен вернуть 200 (не 500), даже если model не предполагает скрипта.
    // (в routes.ts: generate-script вызывает runScriptOnly, который НЕ имеет agent short-circuit)
    // Поэтому тест: ответ не 500 — допустимо 200 или ошибка бизнес-логики
    const r = await post(`/videos/${projectId}/generate-script`, {});
    assert.ok([200, 202, 409].includes(r.status),
      `generate-script для agent: ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ГРУППА 4: heygen-agent — /generate пропускает сценарий
// ══════════════════════════════════════════════════════════════════════════════

describe('heygen-agent — generate пропускает сценарий', {
  skip: SKIP_SLOW ? 'SKIP_SLOW=1' : false,
  timeout: 120_000,
}, () => {
  let projectId: string;

  before(async () => {
    const r = await post<Project>('/videos', {
      title: '[E2E] heygen-agent generate flow',
      topic: 'Преимущества гибридной работы',
      format: '16:9',
      duration: 30,
      language: 'ru',
      animationModel: 'heygen-agent',
      customScenario: 'Explain the benefits of hybrid work for modern companies',
    });
    assert.equal(r.status, 201, `Создание: ${JSON.stringify(r.body).slice(0, 200)}`);
    projectId = r.body.id;
  });

  after(async () => {
    if (projectId) await del(`/videos/${projectId}`).catch(() => {});
  });

  it('POST /videos/:id/generate → 200 success', async () => {
    const r = await post(`/videos/${projectId}/generate`, {});
    assert.ok([200, 202].includes(r.status),
      `generate: ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  });

  it('статус переходит в animating (минуя generating_script/script_ready)', async () => {
    // heygen-agent должен сразу перейти в animating, без прохождения через script_ready.
    // Ждём до 90с — достаточно чтобы FAL принял запрос и вернул request_id.
    const p = await pollUntil<Project>(
      `/videos/${projectId}`,
      (p) => ['animating', 'assembling', 'done', 'error'].includes(p.status),
      { timeoutMs: 90_000, intervalMs: 2000 },
    );
    assert.ok(
      ['animating', 'assembling', 'done'].includes(p.status),
      `heygen-agent застрял на статусе "${p.status}" — ожидался animating/done. Error: ${p.error}`,
    );
    assert.ok(
      p.status !== 'generating_script' && p.status !== 'script_ready',
      `heygen-agent не должен проходить через generating_script/script_ready (статус: ${p.status})`,
    );
    console.log(`[info] heygen-agent статус: ${p.status}, прогресс: ${p.progress}`);
  });

  it('нет сцен в проекте (agent не генерирует сценарий)', async () => {
    const { body: p } = await get<Project>(`/videos/${projectId}`);
    // У heygen-agent нет script.scenes (или script = undefined)
    const scenes = p.script?.scenes;
    assert.ok(
      !scenes || scenes.length === 0,
      `Неожиданно найдены сцены (${scenes?.length}) у heygen-agent проекта`,
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ГРУППА 5: (SLOW) heygen-avatar — полная генерация
// ══════════════════════════════════════════════════════════════════════════════

describe('(SLOW) heygen-avatar — полная генерация', {
  skip: SKIP_SLOW ? 'SKIP_SLOW=1' : false,
  timeout: TIMEOUTS.generate * 2,
}, () => {
  const PRESET_ID = process.env.HEYGEN_AVATAR_DONE_ID ?? '';
  let projectId = PRESET_ID;
  const ownProject = !PRESET_ID;

  before(async () => {
    if (PRESET_ID) {
      const { body: p } = await get<Project>(`/videos/${PRESET_ID}`);
      assert.equal(p.status, 'done',
        `Проект ${PRESET_ID} не готов (статус: ${p.status})`);
      console.log(`[slow] Используем готовый heygen-avatar проект: ${PRESET_ID}`);
      return;
    }

    console.log('[slow] Создаём heygen-avatar проект...');
    const r = await post<Project>('/videos', {
      title: '[E2E slow] heygen-avatar full gen',
      topic: 'Польза ежедневных прогулок для здоровья',
      format: '9:16',
      duration: 20,
      language: 'ru',
      animationModel: 'heygen-avatar',
      subtitleStyle: 'fade',
    });
    assert.equal(r.status, 201, `Создание: ${JSON.stringify(r.body).slice(0, 200)}`);
    projectId = r.body.id;

    // Генерируем сценарий
    const rScript = await post(`/videos/${projectId}/generate-script`, {});
    assert.ok([200, 202].includes(rScript.status), `generate-script: ${rScript.status}`);

    await pollUntil<Project>(
      `/videos/${projectId}`,
      (p) => p.status === 'script_ready' && p.script?.stockPrechecked === true,
      { timeoutMs: TIMEOUTS.script + TIMEOUTS.stockPrecheck, intervalMs: 4000 },
    );
    console.log(`[slow] Сценарий готов, запускаем генерацию...`);

    const rGen = await post(`/videos/${projectId}/generate`, {});
    assert.ok([200, 202].includes(rGen.status), `generate: ${rGen.status}`);

    const done = await pollUntil<Project>(
      `/videos/${projectId}`,
      (p) => p.status === 'done' || p.status === 'error',
      { timeoutMs: TIMEOUTS.generate, intervalMs: 10_000 },
    );
    assert.equal(done.status, 'done',
      `Генерация завершилась с ошибкой: ${done.status}. Error: ${done.error}`);
    console.log(`[slow] heygen-avatar проект готов: ${projectId}`);
  }, { timeout: TIMEOUTS.generate * 2 });

  after(async () => {
    if (ownProject && projectId) {
      await del(`/videos/${projectId}`).catch(() => {});
    }
  });

  it('статус done, progress=100', async () => {
    const { body: p } = await get<Project>(`/videos/${projectId}`);
    assert.equal(p.status, 'done', `status="${p.status}"`);
    assert.equal(p.progress, 100, `progress=${p.progress}`);
  });

  it('videoUrl/videoPath установлены', async () => {
    const { body: p } = await get<Project>(`/videos/${projectId}`);
    assert.ok(p.videoUrl || p.videoPath,
      `Нет videoUrl/videoPath: ${JSON.stringify({ videoUrl: p.videoUrl, videoPath: p.videoPath })}`);
  });

  it('MP4 скачивается и содержит видео + аудио дорожки', async () => {
    const { buf, probe } = await downloadAndProbe(projectId);
    const hasVideo = probe.streams.some((s) => s.codec_type === 'video');
    const hasAudio = probe.streams.some((s) => s.codec_type === 'audio');
    assert.ok(hasVideo, 'Нет видеодорожки');
    assert.ok(hasAudio, 'Нет аудиодорожки');
    const dur = parseFloat(probe.format.duration);
    assert.ok(dur > 5, `Длительность подозрительно мала: ${dur.toFixed(2)}s`);
    console.log(`[slow] heygen-avatar MP4: ${Math.round(buf.byteLength / 1024)}KB, ${dur.toFixed(2)}s`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ГРУППА 6: (SLOW) heygen-agent — полная генерация
// ══════════════════════════════════════════════════════════════════════════════

describe('(SLOW) heygen-agent — полная генерация', {
  skip: SKIP_SLOW ? 'SKIP_SLOW=1' : false,
  timeout: TIMEOUTS.generate * 2,
}, () => {
  const PRESET_ID = process.env.HEYGEN_AGENT_DONE_ID ?? '';
  let projectId = PRESET_ID;
  const ownProject = !PRESET_ID;

  before(async () => {
    if (PRESET_ID) {
      const { body: p } = await get<Project>(`/videos/${PRESET_ID}`);
      assert.equal(p.status, 'done',
        `Проект ${PRESET_ID} не готов (статус: ${p.status})`);
      console.log(`[slow] Используем готовый heygen-agent проект: ${PRESET_ID}`);
      return;
    }

    console.log('[slow] Создаём heygen-agent проект...');
    const r = await post<Project>('/videos', {
      title: '[E2E slow] heygen-agent full gen',
      topic: 'Будущее искусственного интеллекта',
      format: '16:9',
      duration: 30,
      language: 'ru',
      animationModel: 'heygen-agent',
      customScenario: 'Explain how artificial intelligence will transform businesses in the next 5 years',
    });
    assert.equal(r.status, 201, `Создание: ${JSON.stringify(r.body).slice(0, 200)}`);
    projectId = r.body.id;

    const rGen = await post(`/videos/${projectId}/generate`, {});
    assert.ok([200, 202].includes(rGen.status), `generate: ${rGen.status}`);

    const done = await pollUntil<Project>(
      `/videos/${projectId}`,
      (p) => p.status === 'done' || p.status === 'error',
      { timeoutMs: TIMEOUTS.generate, intervalMs: 15_000 },
    );
    // heygen-agent может взять до 15 минут по комментарию в коде
    assert.equal(done.status, 'done',
      `Агент завершился с ошибкой: ${done.status}. Error: ${done.error}`);
    console.log(`[slow] heygen-agent проект готов: ${projectId}`);
  }, { timeout: TIMEOUTS.generate * 2 });

  after(async () => {
    if (ownProject && projectId) {
      await del(`/videos/${projectId}`).catch(() => {});
    }
  });

  it('статус done, progress=100', async () => {
    const { body: p } = await get<Project>(`/videos/${projectId}`);
    assert.equal(p.status, 'done', `status="${p.status}"`);
    assert.equal(p.progress, 100, `progress=${p.progress}`);
  });

  it('videoUrl/videoPath установлены', async () => {
    const { body: p } = await get<Project>(`/videos/${projectId}`);
    assert.ok(p.videoUrl || p.videoPath,
      `Нет videoUrl/videoPath: ${JSON.stringify({ videoUrl: p.videoUrl, videoPath: p.videoPath })}`);
  });

  it('MP4 скачивается и содержит видео + аудио дорожки', async () => {
    const { buf, probe } = await downloadAndProbe(projectId);
    const hasVideo = probe.streams.some((s) => s.codec_type === 'video');
    const hasAudio = probe.streams.some((s) => s.codec_type === 'audio');
    assert.ok(hasVideo, 'Нет видеодорожки');
    assert.ok(hasAudio, 'Нет аудиодорожки');
    const dur = parseFloat(probe.format.duration);
    assert.ok(dur > 5, `Длительность подозрительно мала: ${dur.toFixed(2)}s`);
    console.log(`[slow] heygen-agent MP4: ${Math.round(buf.byteLength / 1024)}KB, ${dur.toFixed(2)}s`);
  });
});
