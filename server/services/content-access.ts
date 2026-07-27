/**
 * Единая проверка владения контентом для публикующих ручек.
 *
 * Почему отдельный модуль, а не копия в каждом роутере: публикация ходит
 * СЕРВИСНЫМ токеном (фоновая публикация не должна зависеть от сессии владельца),
 * а сервисный токен читает контент всех арендаторов. Значит владение надо
 * проверять ЯВНО и одинаково во всех точках — иначе очередная ручка тихо
 * откроет публикацию чужого contentId (ровно та регрессия, что ловит
 * publish-tenant-boundary.test.ts). Копии расходятся; единственный источник — нет.
 *
 * Контракт: читает campaign_id контента сервисным токеном, затем сверяет доступ
 * к кампании через authorizeCampaignAccess. При отказе САМ пишет ответ в res
 * (404 — не подтверждаем существование чужого контента; 503 — Directus недоступен)
 * и возвращает false. true — только когда доступ подтверждён.
 */

import axios from 'axios';
import type { Request, Response } from 'express';
import { authorizeCampaignAccess, CampaignAccessError } from './campaign-access';
import { resolvePublishingToken } from './publishing-token';

export async function assertContentBelongsToRequester(
  contentId: string,
  req: Request,
  res: Response,
): Promise<boolean> {
  const notFound = () => {
    // 404, а не 403: не подтверждаем существование чужого контента.
    res.status(404).json({ success: false, error: 'Контент не найден' });
    return false;
  };

  const directusUrl = process.env.DIRECTUS_URL;
  const serviceToken = await resolvePublishingToken();
  if (!directusUrl || !serviceToken) {
    res.status(500).json({ success: false, error: 'Отсутствует доступ к Directus' });
    return false;
  }

  let campaignRef: any;
  try {
    const resp = await axios.get(
      `${directusUrl}/items/campaign_content/${encodeURIComponent(contentId)}?fields=campaign_id`,
      { headers: { Authorization: `Bearer ${serviceToken}` } },
    );
    campaignRef = resp.data?.data?.campaign_id;
  } catch {
    return notFound();
  }

  const campaignId = typeof campaignRef === 'object' && campaignRef !== null ? campaignRef.id : campaignRef;
  if (!campaignId) return notFound();

  try {
    await authorizeCampaignAccess(
      String(campaignId),
      (req as any).user?.id,
      (req as any).user?.token || '',
      (req as any).user?.is_smm_admin === true,
    );
    return true;
  } catch (accessErr: any) {
    if (accessErr instanceof CampaignAccessError && accessErr.status === 503) {
      res.status(503).json({ success: false, error: 'Проверка доступа временно недоступна' });
      return false;
    }
    return notFound();
  }
}
