/**
 * AI-70 (task #70): две команды ИИ-ассистента читают несуществующую
 * коллекцию campaign_trends — реальная коллекция называется
 * campaign_trend_topics. Также дата у записи — created_at, не date_created.
 *
 * Этот тест вызывает настоящий `handleGetAnalytics` / `handleAnalyzeTrends`,
 * подсовывая мок Directus, и проверяет:
 *   1) команда аналитики возвращает ненулевой счётчик трендов
 *      (то есть она действительно читает ту коллекцию, которую читает Directus);
 *   2) команда анализа трендов возвращает осмысленный ответ и НЕ падает;
 *   3) «Последний сбор» берётся из `created_at`, а не из `date_created`.
 *
 * Регрессия: если вернуть имя коллекции обратно на `campaign_trends`,
 * мок «не отдаёт тренды на запрос к campaign_trends» — оба теста краснеют.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Мок directusCrud: подменяем список по коллекциям. Если спросят
// `campaign_trends` — отдаём 403/ошибку; если `campaign_trend_topics` — отдаём тренды.
vi.mock('../services/directus-crud', () => {
  const list = vi.fn(async (collection: string) => {
    if (collection === 'campaign_trends') {
      const e: any = new Error('collection not found');
      e.response = { status: 403 };
      throw e;
    }
    if (collection === 'campaign_trend_topics') {
      return [
        { id: 't1', campaign_id: 'camp-1', title: 'Trend 1', content: 'content 1', created_at: '2026-08-01T10:00:00Z' },
        { id: 't2', campaign_id: 'camp-1', title: 'Trend 2', content: 'content 2', created_at: '2026-08-05T12:00:00Z' },
      ];
    }
    if (collection === 'campaign_content') {
      return [{ id: 'c1', campaign_id: 'camp-1', title: 'Content 1' }];
    }
    if (collection === 'campaign_content_sources') {
      return [{ id: 's1', campaign_id: 'camp-1' }];
    }
    return [];
  });
  return {
    directusCrud: { list, get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  };
});

// Мок geminiDirect — анализ не нужен, возвращаем стабильный текст.
vi.mock('../services/gemini-direct', () => ({
  geminiDirect: { generateContent: vi.fn(async () => ({ text: 'mocked analysis' })) },
}));

// Мок axios — handleAnalyzeTrends внутри может ходить в сеть за дополнительными данными.
vi.mock('axios', () => {
  const fn: any = vi.fn(async () => ({ status: 200, data: { ok: true } }));
  Object.assign(fn, {
    post: vi.fn(async () => ({ status: 200, data: { ok: true } })),
    get: vi.fn(async () => ({ status: 200, data: {} })),
  });
  fn.create = vi.fn(() => ({
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    post: vi.fn(), get: vi.fn(), patch: vi.fn(),
  }));
  return { default: fn };
});

import { handleGetAnalytics, handleAnalyzeTrends } from '../services/ai-assistant/command-handlers';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AI-70: команды ИИ-ассистента используют правильную коллекцию трендов', () => {
  it('handleGetAnalytics: возвращает ненулевой trendsCount (читает campaign_trend_topics)', async () => {
    const result = await handleGetAnalytics(
      { userId: 'u1', campaignId: 'camp-1', authToken: 'tok' } as any,
      {}
    );
    expect(result.success).toBe(true);
    // В тексте ответа есть «🔹 **Тренды:** 2 найдено» — это значит,
    // что тренды пришли из правильной коллекции.
    expect(result.response).toContain('Тренды:** 2 найдено');
  });

  it('handleAnalyzeTrends: возвращает осмысленный ответ с «Последний сбор» из created_at', async () => {
    const result = await handleAnalyzeTrends(
      { userId: 'u1', campaignId: 'camp-1', authToken: 'tok' } as any,
      {}
    );
    expect(result.success).toBe(true);
    // «Последний сбор» должен показать дату из `created_at`.
    expect(result.response).toMatch(/Последний сбор:\s*\d/);
    // И НЕ должно быть «Не проводился» — у нас есть тренды с created_at.
    expect(result.response).not.toContain('Не проводился');
  });
});