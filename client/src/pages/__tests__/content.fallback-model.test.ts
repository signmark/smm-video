/**
 * task #100: уведомление о результате генерации — реальная производственная функция.
 *
 * `notifyGenerationResult` экспортирована из content/index.tsx, это ТА функция,
 * которую вызывает handleGenerateAiText. Она принимает реальный ответ + toast
 * и эмитит фактический title+description. Тест проверяет ОБА рендеримых поля и
 * что toast вызван ровно так, как должен.
 *
 * (Полный render ContentPage не используется: страница ~4000 строк с интервалами
 *  в jsdom не завершается. Покрываем производственную функцию уведомления, к
 *  которой сводится реальный обработчик.)
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

let notifyGenerationResult: any;

beforeAll(async () => {
  if (typeof window !== 'undefined' && !window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    })) as any;
  }
  const mod = await import('@/pages/content/index');
  notifyGenerationResult = mod.notifyGenerationResult;
});

describe('task #100: notifyGenerationResult — fallback', () => {
  it('Gemini→DeepSeek: недоступна Gemini, ответ через DeepSeek, toast вызван', () => {
    const toast = vi.fn();
    const r = notifyGenerationResult({
      model: 'deepseek-chat', service: 'deepseek',
      originalService: 'gemini-2.5-flash', isFallback: true,
    }, null, toast);

    expect(r.title).toBe('Модель переключена');
    expect(r.description).toContain('Gemini 2.5 Flash была недоступна');
    expect(r.description).toContain('Ответ через DeepSeek');
    // Две подписи НЕ схлопываются.
    expect(r.description).not.toContain('Ответ через Gemini 2.5 Flash');
    // toast вызван с теми же title/description.
    expect(toast).toHaveBeenCalledWith({ title: 'Модель переключена', description: r.description });
  });
});

describe('task #100: notifyGenerationResult — normal path', () => {
  it('без фолбэка: «Готово» + прежняя формулировка', () => {
    const toast = vi.fn();
    const r = notifyGenerationResult({
      model: 'gemini-2.5-flash', service: 'gemini-proxy',
      originalService: 'gemini-2.5-flash', isFallback: false,
    }, null, toast);

    expect(r.title).toBe('Готово');
    expect(r.description).toContain('Текст сгенерирован');
    expect(r.description).not.toContain('недоступна');
    expect(toast).toHaveBeenCalledWith({ title: 'Готово', description: r.description });
  });

  it('missing model деградирует к aiModel, а не undefined', () => {
    const toast = vi.fn();
    const r = notifyGenerationResult({}, 'gemini-2.5-flash', toast);
    expect(r.description).toContain('Gemini 2.5 Flash');
  });

  it('пустой ответ без полей → безопасный «Gemini»', () => {
    const toast = vi.fn();
    const r = notifyGenerationResult({}, null, toast);
    expect(r.description).toContain('Gemini');
  });
});
