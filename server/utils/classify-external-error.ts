/**
 * AI-65 (срез E, рефакторинг): общий классификатор сбоев внешних вызовов.
 *
 * ЗАЧЕМ: фильтры в журнале работают на машиночитаемых терминах, и эти
 * термины должны быть ОДНИ для всей системы — иначе через месяц
 * «network» в одном файле и «error» в другом на одну и ту же ошибку
 * разъезжаются. Поэтому классификатор живёт здесь и импортируется
 * всеми потребителями: `utils/external-call`, `services/apify`,
 * `services/claude`, `services/deepseek`, `services/social-platforms/telegram-http`.
 *
 * Словарь причин — общий: `auth | rate_limited | server_5xx |
 * timeout | network | error` (+ `api_error` для отказа в теле успешного
 * HTTP-ответа, см. детекторы `isVkApiError` и т.п. в `external-call.ts`).
 *
 * ОГРАНИЧЕНИЯ:
 * — Не импортировать сюда `logger.ts`: до среза C в logger жил
 *   локальный дубль, и 98 тестов подменяют модуль журнала без
 *   `classifyExternalError`. С вынесением классификатора в отдельный
 *   модуль проблема исчезает — подмена журнала больше не затрагивает
 *   причины.
 * — Словарь НЕ расширять без согласования с Tech Lead: фильтры в
 *   журнале ожидают этот набор.
 */

export type ExternalErrorReason =
  | 'auth'
  | 'rate_limited'
  | 'server_5xx'
  | 'timeout'
  | 'network'
  | 'error'
  | 'api_error';

export function classifyExternalError(err: any): ExternalErrorReason {
  if (!err) return 'error';
  const code = String(err.code || '');
  if (code === 'ECONNABORTED' || /timeout/i.test(String(err.message || ''))) return 'timeout';
  if (code === 'ECONNRESET' || code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'EAI_AGAIN') return 'network';
  const status = err.response?.status;
  if (typeof status === 'number') {
    if (status === 401 || status === 403) return 'auth';
    if (status === 429) return 'rate_limited';
    if (status >= 500 && status < 600) return 'server_5xx';
  }
  return 'error';
}
