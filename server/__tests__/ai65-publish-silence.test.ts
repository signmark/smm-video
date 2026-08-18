/**
 * AI-65: на пути публикации молчали места, где отказ виден человеку как враньё.
 *
 * ЧТО БЫЛО. Настройки кампании не разобрались — человек получает «Instagram не
 * настроен» и идёт переподключать исправный аккаунт. Список медиа не разобрался
 * — «нет медиафайла для Stories», хотя файл есть. Проверка на повторную
 * публикацию не дошла до ответа — публикуем вслепую, и у живой аудитории может
 * выйти два одинаковых поста. Список активных автономных сессий не прочитался —
 * включённый режим показывается выключенным. Ни один из этих случаев не
 * оставлял в журнале ничего: ответ человеку был, объяснения не было.
 *
 * ЧТО ПРОВЕРЯЕТСЯ. Два места на пути Stories — поведением: настоящий вызов
 * публикации с подменённым Directus, событие ловится на границе логгера, и там
 * же видно, что человеку вернулся именно тот вводящий в заблуждение ответ.
 * Остальные — сканером исходника (правило 49): поднимать публикацию в Instagram
 * и список кампаний целиком ради одного catch каждый нецелесообразно.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import axios from 'axios';
import { logEvent } from '../utils/logger';
import { publishInstagramStory } from '../services/social-platforms/instagram-stories-service';

vi.mock('../utils/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/logger')>();
  return { ...actual, logEvent: vi.fn(), log: Object.assign(vi.fn(), actual.log) };
});

const mockLogEvent = logEvent as unknown as ReturnType<typeof vi.fn>;
const mockGet = axios.get as unknown as ReturnType<typeof vi.fn>;

const eventsNamed = (name: string) => mockLogEvent.mock.calls.filter((c) => c[0] === name);

const item = (data: unknown) => ({ data: { data } });

const WORKING_IG = { instagram: { token: 'tok', accountId: 'acc' } };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AI-65: «Instagram не настроен» при исправном аккаунте перестало быть немым', () => {
  it('нечитаемые настройки кампании названы, а не выданы за отсутствие настройки', async () => {
    mockGet
      .mockResolvedValueOnce(item({ id: 'c1', campaign_id: 'camp-1' }))
      .mockResolvedValueOnce(item({ social_media_settings: '{это не json' }));

    const res = await publishInstagramStory('c1', 'admin-token');

    // Человеку по-прежнему отвечаем как раньше — поведение не меняли.
    expect(res.success).toBe(false);
    expect(res.error).toContain('не настроен');

    const [call] = eventsNamed('campaign.settings_unparsable');
    expect(call, 'причина обязана быть в журнале').toBeTruthy();
    expect(call[1].campaignId).toBe('camp-1');
    expect(call[1].platform).toBe('instagram');
    expect(call[2]).toBe('warn');
  });

  it('исправные настройки не шумят', async () => {
    mockGet
      .mockResolvedValueOnce(item({ id: 'c2', campaign_id: 'camp-2', image_url: 'https://x/i.jpg' }))
      .mockResolvedValueOnce(item({ social_media_settings: JSON.stringify(WORKING_IG) }))
      .mockResolvedValue(item({ username: 'acc' }));

    await publishInstagramStory('c2', 'admin-token');

    expect(eventsNamed('campaign.settings_unparsable')).toHaveLength(0);
  });
});

describe('AI-65: «нет медиафайла» при наличии файла тоже названо', () => {
  it('нечитаемый список дополнительных медиа записан с указанием поля', async () => {
    mockGet
      .mockResolvedValueOnce(item({
        id: 'c3',
        campaign_id: 'camp-3',
        additional_media: '[битый список',
      }))
      .mockResolvedValueOnce(item({ social_media_settings: WORKING_IG }));

    const res = await publishInstagramStory('c3', 'admin-token');

    expect(res.success).toBe(false);
    expect(res.error).toContain('Нет медиафайла');

    const [call] = eventsNamed('publish.media_list_unparsable');
    expect(call).toBeTruthy();
    expect(call[1].contentId).toBe('c3');
    // Полей два, и чинятся они по-разному — какое именно, видно в событии.
    expect(call[1].collection).toBe('additional_media');
  });

  it('нечитаемый список изображений отличим от списка медиа', async () => {
    mockGet
      .mockResolvedValueOnce(item({
        id: 'c4',
        campaign_id: 'camp-4',
        additional_images: '[тоже битый',
      }))
      .mockResolvedValueOnce(item({ social_media_settings: WORKING_IG }));

    await publishInstagramStory('c4', 'admin-token');

    const [call] = eventsNamed('publish.media_list_unparsable');
    expect(call).toBeTruthy();
    expect(call[1].collection).toBe('additional_images');
  });

  it('в событие не уходит содержимое поля', async () => {
    mockGet
      .mockResolvedValueOnce(item({
        id: 'c5',
        campaign_id: 'camp-5',
        additional_media: '[секретная-строка-из-данных',
      }))
      .mockResolvedValueOnce(item({ social_media_settings: WORKING_IG }));

    await publishInstagramStory('c5', 'admin-token');

    const fields = JSON.stringify(eventsNamed('publish.media_list_unparsable')[0][1]);
    expect(fields).not.toContain('секретная-строка-из-данных');
  });
});

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf-8');

describe('AI-65: остальные молчания этого прохода названы', () => {
  it('несработавшая защита от повторной публикации записана как предупреждение', () => {
    const s = read('services/social-platforms/instagram-service.ts');
    const idx = s.indexOf("'publish.duplicate_check_failed'");
    expect(idx).toBeGreaterThan(0);
    const call = s.slice(idx, idx + 300);
    expect(call).toContain('contentId');
    // Два одинаковых поста у живой аудитории — это предупреждение, не отладка.
    expect(call).toContain("'warn'");
    // Публикация всё равно должна пойти: иначе человек теряет пост из-за Directus.
    expect(call).not.toMatch(/\bthrow\b/);
  });

  it('неполученная постоянная ссылка записана как отладка', () => {
    const s = read('services/social-platforms/instagram-service.ts');
    const idx = s.indexOf("'publish.permalink_unresolved'");
    expect(idx).toBeGreaterThan(0);
    // Пост опубликован — это не поломка, а объяснение жалобы про ссылку.
    expect(s.slice(idx, idx + 300)).toContain("'debug'");
  });

  it('непрочитанные автономные сессии больше не выглядят как выключённый режим', () => {
    const s = read('routes/campaigns.ts');
    const idx = s.indexOf("'campaign.active_sessions_unreadable'");
    expect(idx).toBeGreaterThan(0);
    expect(s.slice(idx, idx + 300)).toContain("'warn'");
  });

  it('генерация на значениях по умолчанию объяснена', () => {
    const s = read('routes/content.ts');
    const idx = s.indexOf("'campaign.settings_unreadable'");
    expect(idx).toBeGreaterThan(0);
    expect(s.slice(idx, idx + 300)).toContain("'warn'");
  });

  it('лестница разбора JSON молчит намеренно и это объяснено', () => {
    const s = read('routes/campaigns.ts');
    const head = s.slice(s.indexOf('Try multiple extraction strategies'), s.indexOf('const extractJson'));
    // Три попытки подряд — неудача каждой обычный ход, а не отказ.
    expect(head).toContain('AI-65');
  });
});
