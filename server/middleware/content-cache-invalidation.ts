/**
 * Сбрасывает in-memory кеш контента после любого успешного изменяющего запроса.
 *
 * Зачем middleware, а не вызов в каждом хендлере: `campaign_content` меняется из
 * ~25 мест (роуты, вебхуки, сервисы платформ), и на момент написания 13 файлов
 * не сбрасывали кеш вообще. Пользователь видел это так: повторная публикация
 * проходит, пост реально появляется, но карточка ещё до минуты показывает
 * прежнюю ошибку — ровно CONTENT_CACHE_TTL. Дисциплина «не забудь позвать
 * invalidateContentCache» уже не сработала, поэтому инвалидация переносится в
 * одну точку, через которую проходят все запросы.
 *
 * Фоновые записи (планировщик) сюда не попадают — они сбрасывают кеш сами,
 * в `mergeAndSavePlatformStatus`.
 */

import type { Request, Response, NextFunction } from 'express';
import { invalidateContentCache } from '../utils/content-cache';

/** campaignId может приехать в теле, параметрах пути или query — берём первое найденное. */
function extractCampaignId(req: Request): string | undefined {
  const candidates = [
    (req.body as any)?.campaignId,
    (req.body as any)?.campaign_id,
    (req.params as any)?.campaignId,
    (req.params as any)?.campaign_id,
    (req.query as any)?.campaignId,
    (req.query as any)?.campaign_id,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value) return value;
    // campaign_id иногда приходит объектом-связью {id: "..."}
    if (value && typeof value === 'object' && typeof (value as any).id === 'string') {
      return (value as any).id;
    }
  }
  return undefined;
}

export function invalidateContentCacheOnMutation(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }

  res.on('finish', () => {
    // Провалившийся запрос ничего не изменил — сбрасывать нечего.
    if (res.statusCode >= 400) return;

    const userId = (req as any).user?.id;
    if (typeof userId !== 'string' || !userId) return;

    // campaignId знаем не всегда; без него чистим весь кеш пользователя — это
    // дешевле (Map в памяти), чем отдать ему устаревшую карточку.
    invalidateContentCache(userId, extractCampaignId(req));
  });

  next();
}
