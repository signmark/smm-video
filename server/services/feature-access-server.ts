/**
 * SM-36. Серверная сторона проверки доступа.
 *
 * Почты в токене может не быть: Directus кладёт в него идентификатор и роль,
 * а `req.user.email` заполняется из полезной нагрузки токена и потому часто
 * пуст. Решать доступ по пустой почте — значит отказать владельцу. Поэтому
 * почту спрашиваем у Directus административным токеном, ровно как это делает
 * маршрут профиля.
 */
import { detectEnvironment } from '../utils/environment-detector';
import { hasFeatureAccess, type PersonalFeature } from '@shared/feature-access';
import { log } from '../utils/logger';

/** Почта пользователя по его идентификатору; null — спросить не удалось. */
export async function fetchUserEmail(userId: string): Promise<string | null> {
  const adminToken = process.env.DIRECTUS_STATIC_TOKEN;
  if (!adminToken || !userId) return null;
  try {
    const { directusUrl } = detectEnvironment();
    const resp = await fetch(`${directusUrl}/users/${userId}?fields=email`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!resp.ok) return null;
    const json: any = await resp.json();
    return json?.data?.email || null;
  } catch (err: any) {
    log(`SM-36: не удалось узнать почту пользователя ${userId}: ${err?.message}`, 'feature-access', 'error');
    return null;
  }
}

/**
 * Доступна ли возможность этому пользователю. Если почту узнать не удалось,
 * отвечаем «нет»: молчаливое «да» при сбое — это открытая дверь.
 */
export async function userHasFeature(userId: string | undefined, feature: PersonalFeature): Promise<boolean> {
  if (!userId) return false;
  const email = await fetchUserEmail(userId);
  return hasFeatureAccess({ email }, feature, process.env as Record<string, string | undefined>);
}
