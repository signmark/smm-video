import { directusCrud } from './directus-crud';
import { collectTrendsForCampaign } from './trend-collector';
import { log } from '../utils/logger';

const INACTIVITY_THRESHOLD_HOURS = 24;
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // Каждый час проверяем

let schedulerTimer: NodeJS.Timeout | null = null;

/**
 * Получает все кампании, для которых нет активного автономного режима
 * и у которых есть источники для сбора трендов
 */
async function getCampaignsForCollection(): Promise<Array<{
  campaignId: string;
  userId: string;
  lastActivity: Date | null;
}>> {
  try {
    const campaigns = await directusCrud.list('user_campaigns', {
      fields: ['id', 'user_id', 'updated_at', 'created_at'],
      limit: -1,
      useAdminToken: true
    }) as any[];

    if (!Array.isArray(campaigns)) return [];

    return campaigns.map((c: any) => ({
      campaignId: c.id,
      userId: c.user_id,
      lastActivity: c.updated_at ? new Date(c.updated_at) : (c.created_at ? new Date(c.created_at) : null)
    }));
  } catch (err: any) {
    log(`[DailyScheduler] Ошибка получения кампаний: ${err.message}`, 'error');
    return [];
  }
}

async function hasSources(campaignId: string): Promise<boolean> {
  try {
    const sources = await directusCrud.list('campaign_content_sources', {
      filter: { campaign_id: { _eq: campaignId } },
      fields: ['id'],
      limit: 1,
      useAdminToken: true
    }) as any[];
    return Array.isArray(sources) && sources.length > 0;
  } catch {
    return false;
  }
}

function isInactive(lastActivity: Date | null): boolean {
  if (!lastActivity) return true;
  const hoursAgo = (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60);
  return hoursAgo >= INACTIVITY_THRESHOLD_HOURS;
}

/**
 * Основной цикл планировщика — запускается раз в час,
 * собирает тренды для неактивных кампаний без автономного режима
 */
async function runDailyCheck(activeAutonomousCampaigns: Set<string>) {
  log('[DailyScheduler] 🕐 Проверка неактивных кампаний...', 'info');

  try {
    const campaigns = await getCampaignsForCollection();
    log(`[DailyScheduler] Найдено кампаний: ${campaigns.length}`, 'info');

    for (const campaign of campaigns) {
      // Пропускаем кампании с активным автономным режимом
      if (activeAutonomousCampaigns.has(campaign.campaignId)) {
        continue;
      }

      // Пропускаем активных пользователей
      if (!isInactive(campaign.lastActivity)) {
        continue;
      }

      // Проверяем что есть источники для сбора
      const hasSrc = await hasSources(campaign.campaignId);
      if (!hasSrc) continue;

      log(`[DailyScheduler] 📊 Запуск сбора трендов для кампании ${campaign.campaignId} (неактивна >24ч)`, 'info');

      try {
        const adminToken = process.env.DIRECTUS_STATIC_TOKEN || '';
        const result = await collectTrendsForCampaign({
          campaignId: campaign.campaignId,
          userId: campaign.userId,
          authToken: adminToken,
          postsPerPlatform: 15,
          daysSince: 7
        });
        log(`[DailyScheduler] ✅ Кампания ${campaign.campaignId}: ${result.total} трендов собрано`, 'info');
      } catch (err: any) {
        log(`[DailyScheduler] ❌ Ошибка сбора для кампании ${campaign.campaignId}: ${err.message}`, 'error');
      }

      // Пауза между кампаниями чтобы не перегружать скрейпер
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    log('[DailyScheduler] ✅ Проверка завершена', 'info');
  } catch (err: any) {
    log(`[DailyScheduler] ❌ Критическая ошибка: ${err.message}`, 'error');
  }
}

/**
 * Запускает планировщик ежедневного сбора трендов
 * @param getActiveAutonomousCampaigns - функция, возвращающая список кампаний с активным автономным режимом
 */
export function startDailyTrendScheduler(getActiveAutonomousCampaigns: () => Set<string>) {
  if (schedulerTimer) {
    log('[DailyScheduler] Уже запущен', 'warn');
    return;
  }

  log('[DailyScheduler] 🚀 Запуск ежедневного планировщика трендов', 'info');

  // Первый запуск через 10 минут после старта сервера
  const firstRunDelay = 10 * 60 * 1000;
  setTimeout(async () => {
    await runDailyCheck(getActiveAutonomousCampaigns());
  }, firstRunDelay);

  // Повторяем каждый час
  schedulerTimer = setInterval(async () => {
    await runDailyCheck(getActiveAutonomousCampaigns());
  }, CHECK_INTERVAL_MS);

  log(`[DailyScheduler] ⏰ Первый запуск через 10 минут, затем каждый час`, 'info');
}

export function stopDailyTrendScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    log('[DailyScheduler] 🛑 Планировщик остановлен', 'info');
  }
}
