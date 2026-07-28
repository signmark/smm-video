/**
 * Один канал — несколько получателей.
 *
 * Находки ревью 2026-07-28:
 *  (а) состояние хранилось по одному channelId. Канал, подключённый к двум кампаниям,
 *      отдавал событие первой из них; та переписывала состояние, и вторая на том же
 *      цикле видела дельту 0 — уведомление терялось молча.
 *  (б) checkpoint обновлялся ДО доставки, поэтому одна временная ошибка Telegram
 *      съедала событие навсегда.
 *
 * Здесь проверяется весь цикл runEngagementCheck, а не только чистая функция: разделение
 * «посчитать» и «подтвердить» имеет смысл только вместе с доставкой.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PostDynamics } from '../services/scraper-analytics';

const H = vi.hoisted(() => ({
  notifyUser: vi.fn(),
  getChannelPostsDynamics: vi.fn(),
  getAllMonitoredChannels: vi.fn(),
  axiosGet: vi.fn(),
}));

vi.mock('../services/notify-user', () => ({
  notifyUser: H.notifyUser,
  escapeHtml: (s: string) => s,
}));

vi.mock('../services/scraper-analytics', () => ({
  getChannelPostsDynamics: H.getChannelPostsDynamics,
  getAllMonitoredChannels: H.getAllMonitoredChannels,
}));

vi.mock('axios', () => ({ default: { get: H.axiosGet } }));

vi.mock('../utils/logger', () => {
  const log: any = vi.fn();
  log.debug = vi.fn(); log.info = vi.fn(); log.warn = vi.fn(); log.error = vi.fn();
  return { log, default: log };
});

// Обе кампании (разных пользователей) слушают ОДИН канал.
vi.mock('../services/campaign-analytics-channels', () => ({
  getCampaignAnalyticsChannels: () => [{ channelId: 'shared-channel', platform: 'telegram' }],
  buildMonitoredChannelIndex: () => new Map(),
}));

import { runEngagementCheck, resetEngagementState } from '../services/engagement-watcher';

function post(id: string, views: number, comments: number): PostDynamics {
  return {
    platform_post_id: id,
    published_date: '2026-07-20T10:00:00Z',
    data_points: [{ date: '2026-07-20', views, likes: 0, comments, shares: 0, engagement_rate: 0 }],
    first_views: views,
    current_views: views,
    views_growth: 0,
    views_growth_percent: 0,
    trend: 'stable',
  } as PostDynamics;
}

const CAMPAIGNS = [
  { id: 'campaign-A', name: 'Кампания А', user_id: 'user-1', social_media_settings: { telegram: {} } },
  { id: 'campaign-B', name: 'Кампания Б', user_id: 'user-2', social_media_settings: { telegram: {} } },
];

/** Динамика, которую отдаёт канал на текущем цикле. */
let currentPosts: PostDynamics[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  resetEngagementState();

  process.env.DIRECTUS_URL = 'https://directus.test';
  process.env.DIRECTUS_STATIC_TOKEN = 'admin-token';

  H.axiosGet.mockResolvedValue({ status: 200, data: { data: CAMPAIGNS } });
  H.getAllMonitoredChannels.mockResolvedValue({ items: [] });
  H.getChannelPostsDynamics.mockImplementation(async () => ({ posts: currentPosts }));
  H.notifyUser.mockResolvedValue('telegram');
});

/** Уведомления, ушедшие каждому пользователю. */
function notifiedUsers(): string[] {
  return H.notifyUser.mock.calls.map(c => c[0].userId);
}

describe('один канал в двух кампаниях', () => {
  it('обе кампании разных пользователей получают одно и то же новое событие', async () => {
    // Цикл 1 — baseline, тишина.
    currentPosts = [post('p1', 1000, 5)];
    await runEngagementCheck();
    expect(H.notifyUser).not.toHaveBeenCalled();

    // Цикл 2 — появились комментарии.
    currentPosts = [post('p1', 1000, 9)];
    await runEngagementCheck();

    expect(notifiedUsers().sort()).toEqual(['user-1', 'user-2']);
  });

  it('канал опрашивается один раз за цикл, несмотря на двух получателей', async () => {
    currentPosts = [post('p1', 1000, 5)];
    await runEngagementCheck();

    expect(H.getChannelPostsDynamics).toHaveBeenCalledTimes(1);
  });

  it('после успешной доставки повторный цикл не дублирует событие', async () => {
    currentPosts = [post('p1', 1000, 5)];
    await runEngagementCheck();

    currentPosts = [post('p1', 1000, 9)];
    await runEngagementCheck();
    expect(H.notifyUser).toHaveBeenCalledTimes(2);

    // Третий цикл с теми же цифрами — новых событий нет.
    H.notifyUser.mockClear();
    await runEngagementCheck();
    expect(H.notifyUser).not.toHaveBeenCalled();
  });
});

describe('сбой доставки', () => {
  it('сбой у первой кампании не лишает вторую уведомления', async () => {
    currentPosts = [post('p1', 1000, 5)];
    await runEngagementCheck();

    H.notifyUser.mockImplementation(async ({ userId }: any) => {
      if (userId === 'user-1') throw new Error('Telegram 502');
      return 'telegram';
    });

    currentPosts = [post('p1', 1000, 9)];
    await runEngagementCheck();

    // Вторая кампания получила своё, несмотря на падение первой
    expect(notifiedUsers()).toContain('user-2');
  });

  it('несостоявшаяся доставка повторяется на следующем цикле', async () => {
    currentPosts = [post('p1', 1000, 5)];
    await runEngagementCheck();

    // Оба получателя недоступны
    H.notifyUser.mockResolvedValue('none');
    currentPosts = [post('p1', 1000, 9)];
    await runEngagementCheck();

    // Связь восстановилась — событие не потеряно, цифры те же самые
    H.notifyUser.mockClear();
    H.notifyUser.mockResolvedValue('telegram');
    await runEngagementCheck();

    expect(notifiedUsers().sort()).toEqual(['user-1', 'user-2']);
  });

  it('брошенное исключение при доставке не подтверждает состояние', async () => {
    currentPosts = [post('p1', 1000, 5)];
    await runEngagementCheck();

    H.notifyUser.mockRejectedValue(new Error('сеть отвалилась'));
    currentPosts = [post('p1', 1000, 9)];
    await runEngagementCheck();

    H.notifyUser.mockClear();
    H.notifyUser.mockResolvedValue('telegram');
    await runEngagementCheck();

    expect(notifiedUsers().sort()).toEqual(['user-1', 'user-2']);
  });

  it('после успешной доставки повтора уже нет', async () => {
    currentPosts = [post('p1', 1000, 5)];
    await runEngagementCheck();

    H.notifyUser.mockResolvedValue('none');
    currentPosts = [post('p1', 1000, 9)];
    await runEngagementCheck();

    H.notifyUser.mockResolvedValue('telegram');
    await runEngagementCheck(); // доставлено

    H.notifyUser.mockClear();
    await runEngagementCheck(); // те же цифры — тишина
    expect(H.notifyUser).not.toHaveBeenCalled();
  });
});
