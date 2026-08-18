/**
 * AI-65: последние пустые catch на сервере.
 *
 * ЧТО БЫЛО. Одиннадцать молчаний, каждое со своей ценой для человека:
 *
 *  - отметка «публикация не удалась» не записалась — пост навсегда остаётся в
 *    состоянии «публикуется», человек ждёт, кнопки повтора нет, а отказ уже
 *    известен, просто до него не добраться;
 *  - настроенная владельцем цена тарифа не прочиталась — человеку показывается
 *    запасная, и он по ней платит;
 *  - админский токен для сохранения ключевых слов недоступен — разобранные
 *    слова не сохраняются, человек видит пустой список после долгого ожидания;
 *  - настройки соцсетей в аналитике не читаются — статистика выходит пустой, и
 *    человек решает, что у него нет охватов;
 *  - картинка не загрузилась ни в основное хранилище, ни в запасное — человеку
 *    называют оба, но не говорят, что случилось у каждого;
 *  - ролик опубликован, а отметка об этом не записана — человек публикует
 *    второй раз, и на канал уходит дубль;
 *  - исходы публикации Stories по площадкам разбирались пустыми ветками:
 *    результат получали и выбрасывали.
 *
 * ЧТО ПРОВЕРЯЕТСЯ. Цена — поведением: настоящий вызов с недоступным источником,
 * событие ловится на границе логгера, и там же видно, что цена всё-таки
 * вернулась запасная, а не сломала витрину. Остальные — сканером исходника
 * (правило 49).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { globalApiKeysService } from '../services/global-api-keys';
import { logEvent } from '../utils/logger';
import { resolvePlanPrice } from '../services/plan-pricing';

vi.mock('../services/global-api-keys', () => ({
  globalApiKeysService: { getGlobalApiKey: vi.fn() },
}));

vi.mock('../utils/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/logger')>();
  return { ...actual, logEvent: vi.fn() };
});

const mockKey = globalApiKeysService.getGlobalApiKey as unknown as ReturnType<typeof vi.fn>;
const mockLogEvent = logEvent as unknown as ReturnType<typeof vi.fn>;
const eventsNamed = (name: string) => mockLogEvent.mock.calls.filter((c) => c[0] === name);

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.PLAN_PRICE_PRO;
  delete process.env.PLAN_PRICE_PRO_ORIGINAL;
  delete process.env.VITE_PLAN_PRICE_PRO;
  delete process.env.VITE_PLAN_PRICE_PRO_ORIGINAL;
});

describe('AI-65: подменённая цена перестала подменяться молча', () => {
  it('источник цены недоступен — это записано', async () => {
    mockKey.mockRejectedValue(new Error('directus unreachable'));

    const res = await resolvePlanPrice('pro');

    // Витрина не должна падать из-за недоступного Directus — запасная цена есть.
    expect(res.price).toBe(670);
    const calls = eventsNamed('plan.price_source_unavailable');
    expect(calls.length, 'о подмене цены обязана остаться запись').toBeGreaterThan(0);
    expect(calls[0][1].reason).toBe('directus unreachable');
    expect(calls[0][2]).toBe('warn');
  });

  it('настроенная цена прочиталась — в журнале тишина', async () => {
    mockKey.mockResolvedValue('999');

    const res = await resolvePlanPrice('pro');

    expect(res.price).toBe(999);
    expect(eventsNamed('plan.price_source_unavailable')).toHaveLength(0);
  });

  it('пустое значение — не отказ и не шум', async () => {
    // Ключ просто не задан: запасная цена здесь штатный путь, а не поломка.
    mockKey.mockResolvedValue(null);

    const res = await resolvePlanPrice('basic');

    expect(res.price).toBe(390);
    expect(eventsNamed('plan.price_source_unavailable')).toHaveLength(0);
  });
});

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf-8');

describe('AI-65: незаписанная отметка о неудачной публикации названа', () => {
  const src = () => read('api/social-publishing-router.ts');

  it('оба места пишут одно событие уровня ошибки', () => {
    const s = src();
    const idx = [...s.matchAll(/'publish\.status_writeback_failed'/g)].map((m) => m.index || 0);
    // Их ровно два: неудача YouTube и откат статуса при повторе.
    expect(idx).toHaveLength(2);
    for (const i of idx) {
      const call = s.slice(i, i + 300);
      expect(call).toContain('contentId');
      expect(call).toContain('platform');
      // Пост навсегда застревает в «публикуется» — это ошибка, не предупреждение.
      expect(call).toContain("'error'");
    }
  });

  it('пустых catch в маршрутизаторе публикации не осталось', () => {
    expect(src()).not.toMatch(/catch\s*(\([^)]*\))?\s*\{\s*\}/);
  });
});

describe('AI-65: остальные молчания этого прохода', () => {
  it('недоступный админский токен при сохранении ключевых слов записан', () => {
    const s = read('services/ai-service.ts');
    const idx = s.indexOf("'auth.admin_token_unavailable'");
    expect(idx).toBeGreaterThan(0);
    const call = s.slice(idx, idx + 300);
    expect(call).toContain('campaignId');
    expect(call).toContain("'warn'");
  });

  it('нечитаемые настройки в аналитике названы тем же именем, что и в публикации', () => {
    // Одно и то же поле, одна и та же поломка — искать её человек будет по
    // одному имени, а не по двум.
    const s = read('services/analytics-service.ts');
    const idx = s.indexOf("'campaign.settings_unparsable'");
    expect(idx).toBeGreaterThan(0);
    expect(s.slice(idx, idx + 300)).toContain('campaignId');
  });

  it('несостоявшийся немедленный запуск планировщика — отладка, а не тревога', () => {
    const s = read('api/publishing-routes.ts');
    const idx = s.indexOf("'scheduler.run_now_failed'");
    expect(idx).toBeGreaterThan(0);
    // Планировщик возьмёт запись в обычный проход — человек получит публикацию.
    expect(s.slice(idx, idx + 300)).toContain("'debug'");
  });
});

describe('AI-65: намеренное молчание объяснено на месте', () => {
  it('лестница разбора ответа модели в плане контента', () => {
    const s = read('services/content-plan-generator.ts');
    expect(s).not.toMatch(/catch\s*(\([^)]*\))?\s*\{\s*\}/);
    expect(s).toContain('AI-65');
  });

  it('нераскодированная ссылка на медиа', () => {
    const s = read('utils/media-helpers.ts');
    expect(s).not.toMatch(/catch\s*(\([^)]*\))?\s*\{\s*\}/);
    expect(s).toContain('AI-65');
  });
});

describe('AI-65: загрузка картинок и Stories перестали молчать', () => {
  it('обе попытки загрузить картинку называют, у кого именно не вышло', () => {
    const s = read('api/social-publishing-router.ts');
    const idx = [...s.matchAll(/'media\.upload_failed'/g)].map((m) => m.index || 0);
    // Две попытки подряд: основное хранилище и запасное. Человеку в отказе
    // называют оба, поэтому в журнале должно быть видно, что случилось у каждого.
    expect(idx).toHaveLength(2);
    expect(s).toContain("provider: 'imgbb'");
    expect(s).toContain("provider: 'cloudinary'");
  });

  it('исходы публикации Stories по площадкам больше не выбрасываются', () => {
    const s = read('routes/stories.ts');
    // Раньше здесь стоял разбор результатов с пустыми ветками: результат по
    // каждой площадке получали и не использовали никак.
    expect(s).not.toMatch(/if \(success\) \{\s*\} else \{\s*\}/);
    expect(s).toContain("'publish.platform_failed'");
  });

  it('опубликованный ролик без отметки — ошибка: человек опубликует повторно', () => {
    const s = read('routes/stories.ts');
    const idx = s.indexOf("'publish.status_writeback_failed'");
    expect(idx).toBeGreaterThan(0);
    expect(s.slice(idx, idx + 300)).toContain("'error'");
  });

  it('неподготовленный фон и непрочитанные настройки названы', () => {
    const s = read('routes/stories.ts');
    expect(s).toContain("'publish.story_image_unprepared'");
    // То же имя, что в аналитике и в публикации Stories: поломка одна.
    expect(s).toContain("'campaign.settings_unreadable'");
  });

  it('пустых catch в маршрутах Stories не осталось', () => {
    expect(read('routes/stories.ts')).not.toMatch(/catch\s*(\([^)]*\))?\s*\{\s*\}/);
  });
});
