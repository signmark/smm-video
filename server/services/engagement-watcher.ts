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
 *
 * Состояние ведётся ПО ПОЛУЧАТЕЛЯМ, а не по каналам: один канал может быть подключён
 * к нескольким кампаниям, и каждая должна получить своё уведомление об одном и том же
 * событии. Опрос канала при этом остаётся один на цикл. Подтверждается состояние
 * только после успешной доставки — иначе временная ошибка Telegram съедала бы событие
 * навсегда.
 */

import { log } from '../utils/logger';
import { notifyUser, escapeHtml } from './notify-user';
import { getCampaignAnalyticsChannels, buildMonitoredChannelIndex } from './campaign-analytics-channels';
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

/**
 * `получатель::канал` → platform_post_id → последнее ПОДТВЕРЖДЁННОЕ состояние.
 *
 * Ключ обязан включать получателя. Раньше состояние жило по одному channelId, и если
 * канал был подключён к двум кампаниям, первая забирала событие и переписывала
 * состояние, а вторая на том же цикле видела дельту 0 и не получала ничего.
 *
 * «Подтверждённое» — значит доставленное. Состояние двигается только после успешной
 * отправки: раньше checkpoint обновлялся до доставки, и одна временная ошибка
 * Telegram съедала уведомление навсегда.
 */
const seenState = new Map<string, Map<string, PostState>>();

function stateKey(recipientKey: string, channelId: string): string {
  return `${recipientKey}::${channelId}`;
}

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

/** Состояние, посчитанное но ещё не подтверждённое: применяется только после доставки. */
export interface PendingState {
  recipientKey: string;
  channelId: string;
  state: Map<string, PostState>;
}

/**
 * Сравнивает свежую динамику с подтверждённым состоянием получателя.
 *
 * Побочных эффектов НЕТ: возвращает и события, и новое состояние, которое вызывающий
 * обязан зафиксировать через `commitEvents` — но только после того, как уведомление
 * действительно доставлено. Пока не зафиксировано, следующий цикл посчитает те же
 * события заново, то есть временный сбой Telegram больше не съедает уведомление.
 */
export function computeEvents(
  recipientKey: string,
  channelId: string,
  posts: PostDynamics[],
  options?: { spikePercent?: number; minViews?: number },
): { events: EngagementEvent[]; pending: PendingState } {
  const spikePercent = options?.spikePercent ?? VIEWS_SPIKE_PERCENT;
  const minViews = options?.minViews ?? MIN_VIEWS_FOR_SPIKE;

  const key = stateKey(recipientKey, channelId);
  const isFirstRun = !seenState.has(key);
  const confirmed = seenState.get(key);
  // Копия, а не сам Map: до подтверждения трогать состояние нельзя.
  const next = new Map<string, PostState>(confirmed ?? []);
  const events: EngagementEvent[] = [];

  for (const post of posts) {
    const current = latestPoint(post);
    if (!current) continue;

    const previous = confirmed?.get(post.platform_post_id);
    next.set(post.platform_post_id, { comments: current.comments, views: current.views });

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

  return { events, pending: { recipientKey, channelId, state: next } };
}

/** Подтверждает состояние получателя. Вызывается только после успешной доставки. */
export function commitEvents(pending: PendingState): void {
  seenState.set(stateKey(pending.recipientKey, pending.channelId), pending.state);
}

/**
 * Посчитать и сразу подтвердить. Годится там, где доставки нет (запоминание baseline)
 * и в тестах; в рабочем цикле подтверждение всегда идёт отдельно, после отправки.
 */
export function diffAndUpdateState(
  recipientKey: string,
  channelId: string,
  posts: PostDynamics[],
  options?: { spikePercent?: number; minViews?: number },
): EngagementEvent[] {
  const { events, pending } = computeEvents(recipientKey, channelId, posts, options);
  commitEvents(pending);
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
  /** Только `name`: поля `title` у роли админ-токена нет, запрос с ним падает в 403. */
  name?: string;
  user_id?: string;
  social_media_settings?: unknown;
}

/**
 * Загружает кампании с заполненными настройками соцсетей.
 *
 * Постранично по 100, как в refreshAllExpiringVkTokens: `limit: -1` этот Directus
 * отдаёт пустым списком, из-за чего первые прод-циклы видели ноль кампаний.
 */
async function loadCampaigns(): Promise<CampaignRow[]> {
  const adminToken = process.env.DIRECTUS_STATIC_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN;
  const directusUrl = process.env.DIRECTUS_URL;
  if (!adminToken || !directusUrl) {
    log('[ENGAGEMENT] Нет DIRECTUS_URL или админ-токена — цикл пропущен', 'engagement', 'warn');
    return [];
  }

  const axios = (await import('axios')).default;
  const PAGE_SIZE = 100;
  const rows: CampaignRow[] = [];

  for (let page = 1; page <= 100; page++) {
    const response = await axios.get(`${directusUrl}/items/user_campaigns`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      params: {
        // Никаких лишних полей: `title` роли админ-токена недоступен, и запрос
        // целиком отдаёт 403 («no permission to access field title»). Та же грабля,
        // что была с user_created в фильтре доступных кампаний.
        fields: 'id,name,user_id,social_media_settings',
        limit: PAGE_SIZE,
        page,
        filter: { social_media_settings: { _nnull: true } },
      },
      timeout: 20000,
    });

    const batch = response.data?.data;
    if (!Array.isArray(batch)) {
      // Directus на отказ по правам отвечает телом {errors:[...]}, а не массивом.
      // Без этой проверки такой ответ молча превращался в «кампаний нет».
      throw new Error(
        `Directus вернул не список кампаний (HTTP ${response.status}): `
        + JSON.stringify(response.data?.errors?.[0]?.message || response.data).slice(0, 200),
      );
    }

    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }

  return rows;
}

/** Один проход по всем кампаниям. Экспортируется, чтобы можно было дёрнуть вручную. */
export async function runEngagementCheck(): Promise<{
  campaigns: number;
  notified: number;
  totalCampaigns: number;
  monitoredChannels: number;
}> {
  let campaigns: CampaignRow[];
  try {
    campaigns = await loadCampaigns();
  } catch (err: any) {
    log(`[ENGAGEMENT] Не удалось загрузить кампании: ${err.message}`, 'engagement', 'warn');
    return { campaigns: 0, notified: 0, totalCampaigns: 0, monitoredChannels: 0 };
  }

  const { getChannelPostsDynamics, getAllMonitoredChannels } = await import('./scraper-analytics');

  // Один запрос на цикл: индекс уже заведённых в мониторинге каналов. Нужен потому,
  // что analyticsChannelId сохраняется в кампании лениво — только когда пользователь
  // откроет раздел Аналитика. Без индекса уведомления не пошли бы до первого визита.
  let monitoredIndex = new Map<string, string>();
  try {
    const monitored = await getAllMonitoredChannels();
    monitoredIndex = buildMonitoredChannelIndex(monitored.items || []);
  } catch (err: any) {
    log(`[ENGAGEMENT] Не удалось получить список каналов мониторинга: ${err.message}`, 'engagement', 'warn');
  }

  let checked = 0;
  let notified = 0;

  /**
   * Динамика канала за цикл забирается ОДИН раз, даже если канал подключён к
   * нескольким кампаниям: опрос общий, а состояние и доставка — на каждого
   * получателя свои.
   */
  const dynamicsCache = new Map<string, PostDynamics[] | null>();
  async function loadChannel(channelId: string): Promise<PostDynamics[] | null> {
    if (dynamicsCache.has(channelId)) return dynamicsCache.get(channelId)!;
    let posts: PostDynamics[] | null = null;
    try {
      const dynamics = await getChannelPostsDynamics(channelId, { days: DYNAMICS_DAYS });
      posts = dynamics?.posts?.length ? dynamics.posts : null;
    } catch (err: any) {
      log(`[ENGAGEMENT] Канал ${channelId}: ${err.message}`, 'engagement', 'warn');
    }
    dynamicsCache.set(channelId, posts);
    return posts;
  }

  for (const campaign of campaigns) {
    const channels = getCampaignAnalyticsChannels(campaign.social_media_settings, monitoredIndex);
    if (channels.length === 0 || !campaign.user_id) continue;

    checked++;

    // Получатель — кампания: у одного пользователя их может быть несколько, и каждая
    // ведёт свой счёт по своим каналам.
    const recipientKey = campaign.id;
    const events: EngagementEvent[] = [];
    const pendings: PendingState[] = [];

    for (const channel of channels) {
      const posts = await loadChannel(channel.channelId);
      if (!posts) continue;
      const result = computeEvents(recipientKey, channel.channelId, posts);
      events.push(...result.events);
      pendings.push(result.pending);
    }

    // Событий нет — подтверждаем сразу: это запоминание baseline, доставлять нечего.
    if (events.length === 0) {
      pendings.forEach(commitEvents);
      continue;
    }

    // Комментарии важнее всплеска просмотров: на них можно ответить.
    const ordered = [
      ...events.filter(e => e.kind === 'comments'),
      ...events.filter(e => e.kind === 'views').sort((a, b) => b.delta - a.delta),
    ].slice(0, MAX_NOTIFICATIONS_PER_CAMPAIGN);

    const campaignName = campaign.name || 'Кампания';

    // Сбой доставки одному получателю не должен обрывать цикл: остальные кампании
    // ждут своих уведомлений о тех же самых событиях.
    let delivery: string;
    try {
      delivery = await notifyUser({
        userId: campaign.user_id,
        telegramText: buildNotificationText(campaignName, ordered),
      });
    } catch (err: any) {
      log(`[ENGAGEMENT] Кампания ${campaign.id}: доставка упала — ${err.message}`, 'engagement', 'warn');
      continue; // без подтверждения: событие повторится на следующем цикле
    }

    if (delivery === 'none') {
      // Не доставлено — состояние не двигаем, чтобы событие не пропало насовсем.
      log(`[ENGAGEMENT] Кампания ${campaign.id}: уведомление не доставлено, повторим позже`, 'engagement', 'warn');
      continue;
    }

    pendings.forEach(commitEvents);
    notified++;
    log(`[ENGAGEMENT] Кампания ${campaign.id}: отправлено ${ordered.length} событий через ${delivery}`, 'engagement');
  }

  return {
    campaigns: checked,
    notified,
    totalCampaigns: campaigns.length,
    monitoredChannels: monitoredIndex.size,
  };
}

/** Запускает периодический опрос. Повторный вызов игнорируется. */
export function startEngagementWatcher(): void {
  if (running) return;
  if (process.env.ENGAGEMENT_WATCH_ENABLED === 'false') {
    log('[ENGAGEMENT] Наблюдатель выключен через ENGAGEMENT_WATCH_ENABLED=false', 'engagement');
    return;
  }

  running = true;
  // Уровень warn, а не info: в production logMessage глушит info и debug целиком,
  // а старт и итоги циклов сервиса, который пишет живым пользователям, видеть нужно.
  log(`[ENGAGEMENT] Наблюдатель запущен, интервал ${Math.round(CHECK_INTERVAL_MS / 60000)} мин`, 'engagement', 'warn');

  const tick = async () => {
    try {
      const result = await runEngagementCheck();
      // Счётчики агрегатные: по ним видно, где обрывается связка кампания → канал,
      // без выгрузки самих кампаний и их настроек в логи.
      log(
        `[ENGAGEMENT] Кампаний всего: ${result.totalCampaigns}, каналов в мониторинге: ${result.monitoredChannels}, `
        + `с привязанным каналом: ${result.campaigns}, уведомлено: ${result.notified}`,
        'engagement',
        'warn',
      );
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
