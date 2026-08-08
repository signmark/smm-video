/**
 * SM-18 (review @Codex_HM): тракт content-plan-generator должен проводить legacy
 * глобальный промт с literal Facebook через подстановку так, чтобы модели не
 * ушёл literal Facebook ни из плана, ни из редакторского прохода (runEditorPass).
 *
 * Раньше тут была отдельная копия `substituteSocialNetworks` только для
 * плейсхолдера — literal названия не трогались, и исходный регресс возвращался.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/directus-crud', () => ({
  directusCrud: {
    getById: vi.fn(),
    list: vi.fn(),
  },
}));

vi.mock('../services/ai-service', () => ({
  aiService: { generateContent: vi.fn() },
}));

vi.mock('../utils/logger', () => {
  const logFn: any = vi.fn();
  logFn.info = vi.fn(); logFn.warn = vi.fn(); logFn.error = vi.fn(); logFn.debug = vi.fn();
  return { log: logFn, default: logFn };
});

import { directusCrud } from '../services/directus-crud';
import { aiService } from '../services/ai-service';
import { generateContentPlan } from '../services/content-plan-generator';

const getById = vi.mocked(directusCrud.getById);
const generateContent = vi.mocked(aiService.generateContent);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('content-plan-generator тракт (SM-18)', () => {
  it('legacy globalPrompt с literal Facebook не уходит в модель (план + editor pass)', async () => {
    const legacyPrompt =
      'Ты — SMM-менеджер с опытом 3-5 лет. Твоя целевая аудитория — пользователи Facebook. Это предприниматели и маркетологи.';

    // Кампания: Telegram подключён, автономные настройки содержат legacy-промт.
    getById.mockResolvedValue({
      autonomous_settings: JSON.stringify({
        globalPrompt: legacyPrompt,
        alwaysInclude: 'Подпись',
        signature: '— Команда omemo',
        useEditorPass: true,
      }),
      social_media_settings: {
        telegram: { enabled: true, token: 't' },
        facebook: { enabled: false },
      },
    });

    // Модель возвращает план (для план-промта) и отредактированные посты (editor pass).
    const planJson = JSON.stringify([
      { id: '1', title: 'Тема', contentType: 'обучающий', platform: 'telegram', rationale: 'Причина' },
    ]);
    generateContent.mockResolvedValue({ content: planJson });

    const sent: string[] = [];
    generateContent.mockImplementation(async (opts: { prompt: string; systemPrompt?: string }) => {
      sent.push(opts.prompt);
      return { content: planJson };
    });

    const result = await generateContentPlan({
      campaignId: 'camp-1',
      userId: 'user-1',
      userToken: 'token-1',
      settings: { postsCount: 1, period: 1, includeImages: false, includeVideos: false, includeClips: false, includeStories: false },
    });

    expect(result.success).toBe(true);
    // Было минимум два обращения: план и editor pass.
    expect(sent.length).toBeGreaterThanOrEqual(2);
    for (const p of sent) {
      expect(p).not.toContain('Facebook');
      expect(p).not.toContain('[socialNetworks]');
    }
    // Глобальный промт в план-промте раскрыт в подключённую платформу.
    expect(sent[0]).toContain('Telegram');
  });
});
