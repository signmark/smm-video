/**
 * task #100: подписи модели при фолбэке — executable-фикстуры.
 *
 * Панель на странице контента при фолбэке Gemini→DeepSeek должна говорить:
 * «Gemini была недоступна. Ответ через DeepSeek», а НЕ две одинаковые Gemini.
 *
 * Фикстуры повторяют фактическую форму ответа сервера (см. ai-service.ts):
 *   model/service      — реально ответившая модель (deepseek-chat / deepseek);
 *   originalService    — выбранная/недоступная (gemini*).
 */
import { describe, it, expect } from 'vitest';
import { resolveGenerationModelLabels, MODEL_NAMES } from '@/lib/generation-labels';

describe('task #100: resolveGenerationModelLabels — fallback', () => {
  it('Gemini→DeepSeek фолбэк: недоступна Gemini, ответ через DeepSeek', () => {
    const r = resolveGenerationModelLabels({
      model: 'deepseek-chat',
      service: 'deepseek',
      originalService: 'gemini-2.5-flash',
      isFallback: true,
    });

    // originalLabel = выбранная недоступная модель.
    expect(r.originalLabel).toBe('Gemini 2.5 Flash');
    // svcLabel = реально ответившая модель.
    expect(r.svcLabel).toBe('DeepSeek');
    // Ключевой инвариант: два имени НЕ схлопываются.
    expect(r.svcLabel).not.toBe(r.originalLabel);
  });

  it('Gemini→DeepSeek: model задан, service отдаёт deepseek', () => {
    const r = resolveGenerationModelLabels({
      model: 'deepseek',
      service: 'gemini-proxy-fallback',
      originalService: 'gemini-2.5-flash',
    });
    expect(r.originalLabel).toBe('Gemini 2.5 Flash');
    expect(r.svcLabel).toBe('DeepSeek');
    expect(r.svcLabel).not.toBe(r.originalLabel);
  });
});

describe('task #100: resolveGenerationModelLabels — normal path', () => {
  it('без фолбэка: выбранная модель = реальная', () => {
    const r = resolveGenerationModelLabels({
      model: 'gemini-2.5-flash',
      service: 'gemini-proxy',
      originalService: 'gemini-2.5-flash',
    });
    expect(r.svcLabel).toBe('Gemini 2.5 Flash');
    // originalService совпадает — но для обычного пути панель берёт только svcLabel.
  });

  it('unknown/missing model деградирует к атрибуту, а не undefined', () => {
    const r = resolveGenerationModelLabels({}, 'gemini-2.5-flash');
    // displayModel = aiModel (fallback-атрибут), никогда не undefined.
    expect(r.svcLabel).toBe('Gemini 2.5 Flash');
    expect(r.originalLabel).toBeNull();
  });

  it('пустой ответ без полей и без aiModel → безопасный запасной label', () => {
    const r = resolveGenerationModelLabels({}, null);
    expect(r.svcLabel).toBe('Gemini');
    expect(r.originalLabel).toBeNull();
  });
});

describe('task #100: неизвестные псевдонимы не выдумываются', () => {
  it('неизвестный model отдаётся как есть (fallback к строке), без выдумывания', () => {
    const r = resolveGenerationModelLabels({ model: 'some-future-model' });
    expect(r.svcLabel).toBe('some-future-model');
  });
});
