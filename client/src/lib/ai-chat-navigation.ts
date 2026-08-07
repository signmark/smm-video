/**
 * AI-78: куда переходить после создания кампании.
 *
 * Раньше идентификатор доставали регулярным выражением из ТЕКСТА ответа модели:
 * искали подстроку `🆔 ID кампании:`. Формулировка ответа не контракт — достаточно
 * переставить слова или убрать эмодзи, и переход молча перестаёт работать.
 *
 * Причём он уже не работал: такой строки серверный код не производит нигде.
 * Обработчик создания кампании отдаёт `📊 **ID:** <id>`, автономный сценарий —
 * `• ID кампании: <id>`. Условие в чате не совпадало ни с одной из них, поэтому
 * после создания кампании перехода не происходило вообще.
 *
 * Идентификатор при этом всегда приходил структурно, просто в разных местах у
 * двух путей. Здесь он и берётся — из данных, а не из текста для человека.
 */

export interface CampaignCreationResponse {
  campaignId?: unknown;
  data?: {
    campaignId?: unknown;
    campaign?: { id?: unknown; data?: { id?: unknown } } | null;
  } | null;
}

function firstNonEmptyId(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return String(candidate);
  }
  return null;
}

/**
 * Возвращает id созданной кампании или null. Текст ответа не читается вообще —
 * это и есть суть правки: менять формулировки можно свободно.
 */
export function resolveCreatedCampaignId(response: CampaignCreationResponse | null | undefined): string | null {
  if (!response || typeof response !== 'object') return null;

  return firstNonEmptyId(
    response.campaignId,
    response.data?.campaignId,
    response.data?.campaign?.data?.id,
    response.data?.campaign?.id,
  );
}
