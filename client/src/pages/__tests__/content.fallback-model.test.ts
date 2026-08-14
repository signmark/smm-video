/**
 * task #100: подписи модели при фолбэке — реальная производственная функция.
 *
 * `getGenerationToastLabels` экспортирована из content/index.tsx и является ТОЙ
 * функцией, которую выполняет handleGenerateAiText. Импортируем динамически
 * ПОСЛЕ полифилла matchMedia, потому что модуль content/index.tsx при загрузке
 * тянет themeStore → window.matchMedia (в jsdom его нет по умолчанию).
 */
import { describe, it, expect, beforeAll } from 'vitest';

let getGenerationToastLabels: any;

beforeAll(async () => {
  // Полифилл matchMedia до загрузки модуля.
  if (typeof window !== 'undefined' && !window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as any;
  }
  // Динамический импорт — после полифилла.
  const mod = await import('@/pages/content/index');
  getGenerationToastLabels = mod.getGenerationToastLabels;
});

describe('task #100: getGenerationToastLabels — fallback', () => {
  it('Gemini→DeepSeek фолбэк: недоступна Gemini, ответ через DeepSeek', () => {
    const r = getGenerationToastLabels({
      model: 'deepseek-chat',
      service: 'deepseek',
      originalService: 'gemini-2.5-flash',
      isFallback: true,
    }, null);

    expect(r.originalLabel).toBe('Gemini 2.5 Flash');
    expect(r.svcLabel).toBe('DeepSeek');
    expect(r.svcLabel).not.toBe(r.originalLabel);
  });

  it('фолбэк через service: ответ DeepSeek, недоступна Gemini', () => {
    const r = getGenerationToastLabels({
      model: 'deepseek',
      service: 'gemini-proxy-fallback',
      originalService: 'gemini-2.5-flash',
    }, null);
    expect(r.originalLabel).toBe('Gemini 2.5 Flash');
    expect(r.svcLabel).toBe('DeepSeek');
    expect(r.svcLabel).not.toBe(r.originalLabel);
  });
});

describe('task #100: getGenerationToastLabels — normal path', () => {
  it('без фолбэка: выбранная = реальная', () => {
    const r = getGenerationToastLabels({
      model: 'gemini-2.5-flash',
      service: 'gemini-proxy',
      originalService: 'gemini-2.5-flash',
    }, null);
    expect(r.svcLabel).toBe('Gemini 2.5 Flash');
  });

  it('missing model деградирует к aiModel-атрибуту', () => {
    const r = getGenerationToastLabels({}, 'gemini-2.5-flash');
    expect(r.svcLabel).toBe('Gemini 2.5 Flash');
    expect(r.originalLabel).toBeNull();
  });

  it('пустой ответ без полей → безопасный «Gemini», не undefined', () => {
    const r = getGenerationToastLabels({}, null);
    expect(r.svcLabel).toBe('Gemini');
    expect(r.originalLabel).toBeNull();
  });
});
