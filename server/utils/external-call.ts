/**
 * AI-65 срез E: общая обёртка исходящих вызовов к внешним HTTP-сервисам.
 *
 * Назначение — единая точка журналирования для всех исходящих обращений
 * к соцсетям и другим внешним системам. Каждый вызов оставляет в журнале
 * систему, операцию, исход, длительность и причину отказа устойчивым
 * словом. Словарь причин — общий для всех систем (см. `classifyExternalError`).
 *
 * ЗАЧЕМ:
 * — фильтры в журнале работают на машиночитаемых терминах, одинаковых
 *   для всех платформ;
 * — обёртка отделяет «успех HTTP» от «успех по контракту платформы»:
 *   Telegram, VK, TikTok и Instagram Reels отвечают кодом 200 даже
 *   при ошибке, axios не бросает — без проверки тела журнал соврёт;
 * — падающее журналирование не должно ронять публикацию.
 *
 * ОГРАНИЧЕНИЯ:
 * — Обёртка НЕ меняет то, что возвращается вызывающему коду. Ответ
 *   проходит насквозь — успех или ошибка. Решение о провале принимает
 *   вызывающий код (он уже знает, что проверять: `res.ok`, `data.id`,
 *   `data.result`, и т.д.).
 * — Не использовать `axios.interceptors.request.use(...)`: ломает
 *   существующие тесты, которые мокают `axios.post` напрямую.
 * — Cloudinary upload (вспомогательный сервис, не платформа) НЕ оборачивается
 *   этой обёрткой — это инфраструктура.
 */
import { log, classifyExternalError } from './logger';

/**
 * Обёртка для одного исходящего HTTP-вызова.
 *
 * @param system    имя системы ('vk' | 'instagram' | 'facebook' | 'youtube' |
 *                  'threads' | 'tiktok'). Используется в журнале.
 * @param operation короткое имя операции ('wall.post', 'media_publish' и т.д.).
 * @param fn        функция, выполняющая axios-вызов и возвращающая ответ.
 * @param options.isApiError  опциональный детектор «бизнес-провала» в теле
 *                  успешного HTTP-ответа. Если возвращает true, в журнал
 *                  пишется `status: 'error', reason: 'api_error'`.
 *                  Без детектора обёртка доверяет axios — если он бросил,
 *                  это ошибка; если не бросил, это успех.
 *
 * Возвращает: Promise<T> — то, что вернул `fn`. Никаких преобразований.
 *
 * Бросает: ту же ошибку, что бросил `fn` (если бросил).
 */
export async function trackExternalCall<T>(
  system: string,
  operation: string,
  fn: () => Promise<T>,
  options?: { isApiError?: (result: unknown) => boolean }
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    // Некоторые платформы (Telegram, VK, TikTok, Instagram Reels) отвечают
    // HTTP 200 даже на бизнес-ошибки. axios не бросает, и без проверки тела
    // журнал писал бы «ok» для провалившейся публикации.
    // reason намеренно стабильное слово `api_error`, а не `description`
    // — фильтры в журнале работают на машиночитаемых терминах.
    if (options?.isApiError?.(result)) {
      try {
        log.external({
          system,
          operation,
          status: 'error',
          durationMs: Date.now() - startedAt,
          reason: 'api_error',
        });
      } catch {
        /* наблюдение не должно ронять вызов */
      }
    } else {
      try {
        log.external({
          system,
          operation,
          status: 'ok',
          durationMs: Date.now() - startedAt,
        });
      } catch {
        /* наблюдение не должно ронять вызов */
      }
    }
    return result;
  } catch (err) {
    const reason = safeClassify(err);
    try {
      log.external({
        system,
        operation,
        status: reason === 'timeout' ? 'timeout' : 'error',
        durationMs: Date.now() - startedAt,
        reason,
      });
    } catch {
      /* наблюдение не должно ронять вызов */
    }
    throw err;
  }
}

// Если classifyExternalError не экспортирован (например, тест замокал модуль
// logger и забыл про этот экспорт), fallback на 'error' — лучше плохая
// причина в журнале, чем падение обёртки, которая роняет публикацию.
// Используем typeof через обёртку, чтобы избежать падения на этапе импорта,
// когда vitest уже подменил модуль.
function safeClassify(err: unknown): 'auth' | 'rate_limited' | 'server_5xx' | 'timeout' | 'network' | 'error' {
  // Сначала пытаемся использовать общий классификатор из logger.ts.
  // typeof null/undefined безопасен в JS.
  try {
    if (typeof classifyExternalError === 'function') {
      return classifyExternalError(err);
    }
  } catch {
    // vitest иногда бросает ошибку прямо из моков при попытке доступа к
    // undefined-экспортам. Проглатываем — fallback ниже.
  }
  // Локальный fallback: повторяем логику classifyExternalError без зависимости.
  if (!err) return 'error';
  const code = String((err as any).code || '');
  if (code === 'ECONNABORTED' || /timeout/i.test(String((err as any).message || ''))) return 'timeout';
  if (code === 'ECONNRESET' || code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'EAI_AGAIN') return 'network';
  const status = (err as any)?.response?.status;
  if (typeof status === 'number') {
    if (status === 401 || status === 403) return 'auth';
    if (status === 429) return 'rate_limited';
    if (status >= 500 && status < 600) return 'server_5xx';
  }
  return 'error';
}

/**
 * Детектор для VK: `{error: {error_code, error_msg}}` в теле при HTTP 200.
 *
 * VK API возвращает объект `error` в теле даже при успешном коде 200,
 * когда запрос не выполнен (бизнес-ошибка: неверный токен, доступ
 * запрещён, и т.д.). axios не бросает.
 */
export function isVkApiError(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const data = (result as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return false;
  return Boolean((data as { error?: unknown }).error);
}

/**
 * Детектор для TikTok: `{error: {code, message}}` в теле при HTTP 200,
 * где `code !== 'ok'` означает ошибку.
 *
 * TikTok API возвращает объект `error` всегда; поле `code: 'ok'`
 * означает успех, всё остальное — ошибка.
 */
export function isTiktokApiError(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const data = (result as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return false;
  const error = (data as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code !== undefined && code !== 'ok';
}

/**
 * Детектор для Instagram Reels (Graph API media-publish flow):
 * `{error: {message}}` в теле при HTTP 200.
 *
 * В основном Instagram Graph API возвращает ошибки через HTTP 4xx
 * (axios бросает — там разбор тела не нужен). Но в некоторых методах
 * (особенно при ручной обработке ответа) Graph API возвращает 200
 * с объектом `error` в теле — например, если контейнер media ещё
 * не готов к публикации.
 */
export function isInstagramReelsApiError(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const data = (result as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return false;
  return Boolean((data as { error?: unknown }).error);
}