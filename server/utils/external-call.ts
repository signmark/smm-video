/**
 * AI-65 срез E: общая обёртка исходящих вызовов к внешним HTTP-сервисам.
 *
 * Назначение — единая точка журналирования для всех исходящих обращений
 * к соцсетям и другим внешним системам. Каждый вызов оставляет в журнале
 * систему, операцию, исход, длительность и причину отказа устойчивым
 * словом. Словарь причин — общий для всех систем (см. `classifyExternalError`
 * в `utils/classify-external-error`).
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
import { log } from './logger';
import {
  classifyExternalError,
  type ExternalErrorReason,
} from './classify-external-error';

/**
 * Обёртка для одного исходящего HTTP-вызова.
 *
 * ЗАЧЕМ сигнатура `(...args: any[]) => Promise<T>`: некоторые моки в тестах
 * передают аргументы в `trackExternalCall` через bind/call/apply или
 * подменяют вызываемую функцию с переменной арностью. Свободный список
 * `...args` сохраняет типобезопасность возврата и не ломает моков.
 *
 * @param system   имя платформы (vk, tiktok, instagram, facebook, threads, youtube).
 * @param operation имя операции (wall.post, media.publish, ...).
 * @param fn       функция, делающая запрос (обычно `() => axios.post(...)`).
 * @param options.isApiError  опциональный детектор «бизнес-провала» в теле.
 *                            Если он возвращает true, в журнал идёт
 *                            status:'error', reason:'api_error' вместо
 *                            status:'ok'.
 */
export async function trackExternalCall<T>(
  system: string,
  operation: string,
  fn: (...args: any[]) => Promise<T>,
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
    const reason = classifyExternalError(err);
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

export type { ExternalErrorReason };
export { classifyExternalError };
