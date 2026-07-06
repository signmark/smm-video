/**
 * In-memory кеш для campaign_content
 * TTL: 60 секунд. Ключ: userId:campaignId:page:limit
 * Импортируется из content.ts и любых publishing-сервисов.
 */

interface CacheEntry { data: any; expiresAt: number }

const contentCache = new Map<string, CacheEntry>();

export const CONTENT_CACHE_TTL = 60 * 1000; // 60 секунд

export function buildCacheKey(userId: string, campaignId: string, page: number, limit: number): string {
  return `${userId}:${campaignId}:${page}:${limit}`;
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

/**
 * Сбрасывает кеш для конкретной кампании пользователя.
 * Если campaignId не указан — сбрасывает весь кеш пользователя.
 */
export function invalidateContentCache(userId: string, campaignId?: string): void {
  for (const key of contentCache.keys()) {
    if (key.startsWith(userId) && (!campaignId || key.includes(`:${campaignId}:`))) {
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
