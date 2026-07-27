/**
 * Фоновые уведомления о жизни опубликованных постов: новые комментарии и рост охвата.
 *
 * Своего опроса соцсетей здесь нет и быть не должно. Analytics API уже парсит каналы
 * по расписанию, каждые 6 часов обновляет метрики за последние 7 дней и считает динамику
 * поста по точкам замеров. Нам достаточно одного запроса на канал за цикл — забрать
 * готовую динамику и сравнить с тем, что мы видели в прошлый раз.
 *
 * Состояние (последние увиденные комментарии и просмотры по каждому посту) держим в
 * памяти процесса. При перезапуске оно теряется — и это осознанный выбор: первый цикл
 * после старта только запоминает baseline и ничего не шлёт, поэтому рестарт приводит
 * к молчанию, а не к пачке уведомлений о старых событиях.
 */

import { log } from '../utils/logger';
import { notifyUser, escapeHtml } from './notify-user';
import { getCampaignAnalyticsChannels } from './campaign-analytics-channels';
import type { PostDynamics } from './scraper-analytics';

/** Как часто опрашивать. Analytics API обновляет метрики раз в 6 часов — чаще смысла нет. */
const CHECK_INTERVAL_MS = Number(process.env.ENGAGEMENT_WATCH_INTERVAL_MS || 6 * 60 * 60 * 1000);

/** На сколько процентов должны вырасти просмотры, чтобы это считалось всплеском охвата. */
const VIEWS_SPIKE_PERCENT = Number(process.env.ENGAGEMENT_VIEWS_SPIKE_PERCENT || 30);

/** Минимум просмотров, ниже которого рост в процентах — статистический шум. */
const MIN_VIEWS_FOR_SPIKE = Number(process.env.ENGAGEMENT_MIN_VIEWS || 300);

/** Сколько уведомлений максимум за один цикл на пользователя — защита от простыни в боте. */
const MAX_NOTIFICATIONS_PER_CAMPAIGN = Number(process.env.ENGAGEMENT_MAX_NOTIFICATIONS || 3);

/** Глубина анализа динамики. */
const DYNAMICS_DAYS = 7;

interface PostState {
  comments: number;
  views: number;
}

/** channelId → platform_post_id → последнее увиденное состояние. */
const seenState = new Map<string, Map<string, PostState>>();

let timer: NodeJS.Timeout | null = null;
let running = false;

/** Берёт самую свежую точку замера поста. */
function latestPoint(post: PostDynamics): { comments: number; views: number } | null {
  const points = post.data_points || [];
  if (points.length === 0) {
    // Динамики нет, но текущие просмотры API отдаёт всегда
    if (typeof post.current_views === 'number') return { comments: 0, views: post.current_views };
    return null;
  }
  const last = points[points.length - 1];
  return {
    comments: Number(last.comments) || 0,
    views: Number(last.views) || 0,
  };
}

function postUrlLabel(post: PostDynamics): string {
  const date = post.published_date
    ? new Date(post.published_date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
    : '';
  return date ? `от ${date}` : `#${post.platform_post_id}`;
}

export interface EngagementEvent {
  kind: 'comments' | 'views';
  post: PostDynamics;
  /** Насколько выросло: штуки для комментариев, проценты для просмотров. */
  delta: number;
}

/**
 * Сравнивает свежую динамику с запомненным состоянием и возвращает, о чём стоит сообщить.
 * Побочный эффект — обновление состояния: событие про один и тот же рост не повторится.
 *
 * Экспортируется ради тестов: это единственное место, где живёт вся логика решения.
 */
export function diffAndUpdateState(
  channelId: string,
  posts: PostDynamics[],
  options?: { spikePercent?: number; minViews?: number },
): EngagementEvent[] {
  const spikePercent = options?.spikePercent ?? VIEWS_SPIKE_PERCENT;
  const minViews = options?.minViews ?? MIN_VIEWS_FOR_SPIKE;

  const isFirstRun = !seenState.has(channelId);
  const channelState = seenState.get(channelId) || new Map<string, PostState>();
  const events: EngagementEvent[] = [];

  for (const post of posts) {
    const current = latestPoint(post);
    if (!current) continue;

    const previous = channelState.get(post.platform_post_id);
    channelState.set(post.platform_post_id, { comments: current.comments, views: current.views });

    // Первый прогон (или первый раз видим пост) — только запоминаем baseline.
    if (isFirstRun || !previous) continue;

    const newComments = current.comments - previous.comments;
    if (newComments > 0) {
      events.push({ kind: 'comments', post, delta: newComments });
    }

    if (previous.views >= minViews && current.views > previous.views) {
      const growth = ((current.views - previous.views) / previous.views) * 100;
      if (growth >= spikePercent) {
        events.push({ kind: 'views', post, delta: Math.round(growth) });
      }
    }
  }

  seenState.set(channelId, channelState);
  return events;
}

/** Собирает текст уведомления для Telegram. */
export function buildNotificationText(campaignName: string, events: EngagementEvent[]): string {
  const lines = events.map(event => {
    const label = postUrlLabel(event.post);
    return event.kind === 'comments'
      ? `💬 Под постом ${escapeHtml(label)} — ${event.delta} ${pluralComments(event.delta)}`
      : `📈 Пост ${escapeHtml(label)} набирает охват: +${event.delta}% просмотров`;
  });

  return `<b>${escapeHtml(campaignName)}</b>\n\n${lines.join('\n')}`;
}

function pluralComments(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'новый комментарий';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'новых комментария';
  return 'новых комментариев';
}

interface CampaignRow {
  id: string;
  title?: string;
  name?: string;
  user_id?: string;
  social_media_settings?: unknown;
}

/** Загружает кампании, у которых есть привязанный канал аналитики. */
async function loadCampaigns(): Promise<CampaignRow[]> {
  const adminToken = process.env.DIRECTUS_STATIC_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN;
  const directusUrl = process.env.DIRECTUS_URL;
  if (!adminToken || !directusUrl) return [];

  const axios = (await import('axios')).default;
  const response = await axios.get(`${directusUrl}/items/user_campaigns`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    params: { fields: 'id,title,name,user_id,social_media_settings', limit: -1 },
    timeout: 20000,
  });
  return response.data?.data || [];
}

/** Один проход по всем кампаниям. Экспортируется, чтобы можно было дёрнуть вручную. */
export async function runEngagementCheck(): Promise<{ campaigns: number; notified: number }> {
  let campaigns: CampaignRow[];
  try {
    campaigns = await loadCampaigns();
  } catch (err: any) {
    log(`[ENGAGEMENT] Не удалось загрузить кампании: ${err.message}`, 'engagement', 'warn');
    return { campaigns: 0, notified: 0 };
  }

  const { getChannelPostsDynamics } = await import('./scraper-analytics');
  let checked = 0;
  let notified = 0;

  for (const campaign of campaigns) {
    const channels = getCampaignAnalyticsChannels(campaign.social_media_settings);
    if (channels.length === 0 || !campaign.user_id) continue;

    checked++;
    const events: EngagementEvent[] = [];

    for (const channel of channels) {
      try {
        const dynamics = await getChannelPostsDynamics(channel.channelId, { days: DYNAMICS_DAYS });
        if (!dynamics?.posts?.length) continue;
        events.push(...diffAndUpdateState(channel.channelId, dynamics.posts));
      } catch (err: any) {
        log(`[ENGAGEMENT] Канал ${channel.channelId}: ${err.message}`, 'engagement', 'warn');
      }
    }

    if (events.length === 0) continue;

    // Комментарии важнее всплеска просмотров: на них можно ответить.
    const ordered = [
      ...events.filter(e => e.kind === 'comments'),
      ...events.filter(e => e.kind === 'views').sort((a, b) => b.delta - a.delta),
    ].slice(0, MAX_NOTIFICATIONS_PER_CAMPAIGN);

    const campaignName = campaign.title || campaign.name || 'Кампания';
    const channel = await notifyUser({
      userId: campaign.user_id,
      telegramText: buildNotificationText(campaignName, ordered),
    });

    if (channel !== 'none') {
      notified++;
      log(`[ENGAGEMENT] Кампания ${campaign.id}: отправлено ${ordered.length} событий через ${channel}`, 'engagement');
    }
  }

  return { campaigns: checked, notified };
}

/** Запускает периодический опрос. Повторный вызов игнорируется. */
export function startEngagementWatcher(): void {
  if (running) return;
  if (process.env.ENGAGEMENT_WATCH_ENABLED === 'false') {
    log('[ENGAGEMENT] Наблюдатель выключен через ENGAGEMENT_WATCH_ENABLED=false', 'engagement');
    return;
  }

  running = true;
  log(`[ENGAGEMENT] Наблюдатель запущен, интервал ${Math.round(CHECK_INTERVAL_MS / 60000)} мин`, 'engagement');

  const tick = async () => {
    try {
      const result = await runEngagementCheck();
      log(`[ENGAGEMENT] Проверено кампаний: ${result.campaigns}, уведомлено: ${result.notified}`, 'engagement');
    } catch (err: any) {
      log(`[ENGAGEMENT] Ошибка цикла: ${err.message}`, 'engagement', 'error');
    }
  };

  // Первый прогон — с задержкой, чтобы не мешать старту сервера. Он только запоминает
  // baseline и ничего не шлёт, так что торопиться некуда.
  timer = setTimeout(() => {
    void tick();
    timer = setInterval(() => void tick(), CHECK_INTERVAL_MS);
  }, 2 * 60 * 1000);
}

export function stopEngagementWatcher(): void {
  if (timer) {
    clearTimeout(timer);
    clearInterval(timer);
    timer = null;
  }
  running = false;
}

/** Только для тестов: сбрасывает накопленное состояние. */
export function resetEngagementState(): void {
  seenState.clear();
}
