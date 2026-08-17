/**
 * Разбор состояния VK-токенов по кампаниям (AI-65, этап 5).
 *
 * ЗАЧЕМ ОТДЕЛЬНЫМ МОДУЛЕМ. Сама проверка живёт внутри крона в index.ts, куда
 * из теста не дотянуться. А ошибиться здесь легко: «нет токена», «токен есть,
 * но связь разорвана» и «токен скоро истечёт» — три разных состояния с разными
 * последствиями, и путать их нельзя. Решение вынесено сюда, чтобы проверялось
 * напрямую.
 *
 * ЗАЧЕМ ВООБЩЕ. Крон писал предупреждение НА КАЖДУЮ кампанию с разорванной
 * связью, каждые полчаса. На проде это 17 предупреждений за прогон, 34 в час,
 * бесконечно — про кампании, которые никто не собирается переподключать. Из-за
 * этого уровень «предупреждение» перестал что-либо значить: настоящую проблему
 * в таком потоке не видно. Подробности по каждой кампании остаются, но на
 * уровне отладки; наверх поднимается одна строка с числом.
 */

export interface VkCampaignLike {
  id: string;
  name?: string | null;
  social_media_settings?: { vk?: Record<string, any> | null } | null;
}

export interface VkTokenStatus {
  /** Связь жива и токен не на исходе. */
  active: number;
  /** Токен есть, но VK его больше не принимает — нужно переподключение. */
  expired: string[];
  /** Кампании без токена вовсе: VK просто не подключали. */
  noToken: number;
  /** Токен жив, но истекает в ближайшие полчаса. */
  expiringSoon: Array<{ id: string; minutesLeft: number }>;
}

/** Порог, после которого истечение токена стоит упоминания. */
export const EXPIRING_SOON_MINUTES = 30;

export function classifyVkCampaigns(
  campaigns: VkCampaignLike[],
  now: number,
): VkTokenStatus {
  const status: VkTokenStatus = { active: 0, expired: [], noToken: 0, expiringSoon: [] };

  for (const campaign of campaigns ?? []) {
    const vk = campaign?.social_media_settings?.vk;

    if (!vk?.accessToken && !vk?.token) {
      status.noToken++;
      continue;
    }

    if (vk.authExpired) {
      status.expired.push(campaign.id);
      continue;
    }

    const expiresAt = vk.tokenExpiresAt ? new Date(vk.tokenExpiresAt).getTime() : 0;
    if (expiresAt && Number.isFinite(expiresAt)) {
      const minutesLeft = Math.round((expiresAt - now) / 60000);
      if (minutesLeft < EXPIRING_SOON_MINUTES) {
        status.expiringSoon.push({ id: campaign.id, minutesLeft });
      }
    }

    status.active++;
  }

  return status;
}
