/**
 * In-memory кеш для campaign_content
 * TTL: 60 секунд. Ключ: userId:campaignId:page:limit
 * Импортируется из content.ts и любых publishing-сервисов.
 */

interface CacheEntry { data: any; expiresAt: number }

const contentCache = new Map<string, CacheEntry>();

export const CONTENT_CACHE_TTL = 60 * 1000; // 60 секунд

/**
 * `variant` разделяет полную выдачу и облегчённую сводку: тела ответов разные,
 * и без него сводка отдалась бы вместо полного списка (или наоборот).
 * Идёт в конец ключа — инвалидация сверяет префикс `userId:` и `:campaignId:`.
 */
export function buildCacheKey(
  userId: string,
  campaignId: string,
  page: number,
  limit: number,
  variant: 'full' | 'summary' = 'full',
): string {
  return `${userId}:${campaignId}:${page}:${limit}:${variant}`;
}

export function getFromCache(key: string): any | null {
  const e = contentCache.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) { contentCache.delete(key); return null; }
  return e.data;
}

export function setToCache(key: string, data: any): void {
  contentCache.set(key, { data, expiresAt: Date.now() + CONTENT_CACHE_TTL });
}

/** campaign_id приезжает из Directus то строкой, то связью-объектом `{id}`. */
type CampaignRef = string | { id?: string } | null | undefined;

function normalizeCampaignId(campaignId: CampaignRef): string | undefined {
  if (typeof campaignId === 'string') return campaignId || undefined;
  if (campaignId && typeof campaignId === 'object' && typeof campaignId.id === 'string') {
    return campaignId.id || undefined;
  }
  return undefined;
}

/**
 * Сбрасывает кеш для конкретной кампании пользователя.
 * Если campaignId не указан (или пришёл в непонятном виде) — сбрасывает весь кеш
 * пользователя: лишний поход в Directus дешевле устаревшей карточки на экране.
 *
 * Нормализация здесь, а не у вызывающих: часть из них передаёт связь-объект, и
 * раньше ключ получался `:[object Object]:` — инвалидация молча не делала ничего.
 */
export function invalidateContentCache(userId: string, campaignId?: CampaignRef): void {
  if (!userId) return;
  const normalized = normalizeCampaignId(campaignId);
  for (const key of contentCache.keys()) {
    if (key.startsWith(`${userId}:`) && (!normalized || key.includes(`:${normalized}:`))) {
      contentCache.delete(key);
    }
  }
}

/** Полная очистка всего кеша контента */
export function clearContentCache(): void {
  contentCache.clear();
}

/** Автоматическая очистка истёкших записей каждые 5 минут */
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of contentCache) {
    if (now > entry.expiresAt) contentCache.delete(key);
  }
}, 5 * 60 * 1000);
