/**
 * task #100: подписи модели генерации при фолбэке.
 *
 * Сервер при фолбэке (Gemini→DeepSeek) возвращает:
 *   `model`/`service`  — модель, которая РЕАЛЬНО ответила (например deepseek);
 *   `originalService`  — выбранная/недоступная модель (например gemini).
 *
 * Раньше панель на странице контента считала подпись как
 * `originalService || model || service`, поэтому при фолбэке ОБЕ части сообщения
 * получали имя выбранной модели («Gemini была недоступна. Ответ через Gemini»).
 * Здесь сводим выбор в одну чистую функцию и отдаём приоритет реально
 * ответившей модели.
 */
export interface GenerationModelLabels {
  /** Имя модели, которая реально ответила (для «Ответ через X»). */
  svcLabel: string;
  /** Имя выбранной/недоступной модели (для «X была недоступна»), или null. */
  originalLabel: string | null;
}

export const MODEL_NAMES: Record<string, string> = {
  'gemini-3.5-flash': 'Gemini 3.5 Flash',
  'gemini-3.0-pro': 'Gemini 3.0 Pro',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'gemini-2.5-flash-lite': 'Gemini 2.5 Flash Lite',

  'gemini-proxy': 'Gemini',
  'gemini-proxy-fallback': 'Gemini (fallback)',
  'deepseek-chat': 'DeepSeek',
  'deepseek': 'DeepSeek',
  'qwen': 'Qwen',
};

/**
 * Вычисляет подписи модели генерации.
 * @param data ответ сервера ({ model, service, originalService, isFallback }).
 * @param aiModel fallback-имя, если в data нет model/service.
 */
export function resolveGenerationModelLabels(
  data: { model?: string | null; service?: string | null; originalService?: string | null },
  aiModel?: string | null,
): GenerationModelLabels {
  // Реально ответившая модель — приоритет: model → service → originalService → aiModel.
  const displayModel = data.model || data.service || data.originalService || aiModel || 'Gemini';
  const svcLabel = MODEL_NAMES[displayModel] ?? displayModel;
  const originalLabel = data.originalService
    ? (MODEL_NAMES[data.originalService] ?? data.originalService)
    : null;

  return { svcLabel, originalLabel };
}
