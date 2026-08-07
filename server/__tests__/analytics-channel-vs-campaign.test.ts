import { describe, it, expect } from 'vitest';
import {
  aggregateCampaignChannelPosts,
  type ChannelPostRow,
} from '../services/analytics-aggregation';

/**
 * AI-81 (продолжение SM-15). Аналитика кампании намеренно считает только наши
 * публикации и игнорирует ручные посты канала. Тестировщик считал по каналу и
 * получил другое число -- оба верны, но снаружи неразличимы.
 *
 * Владелец решил показывать ОБА числа. Здесь проверяется, что вторая величина
 * действительно про весь канал, а не копия первой: расхождение обязано
 * появляться ровно тогда, когда в канале есть публикация не наша.
 */

function post(id: number, date: string, metrics: Partial<ChannelPostRow> = {}): ChannelPostRow {
  return {
    platform_post_id: String(id),
    published_date: date,
    views: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    ...metrics,
  };
}

describe('AI-81: метрики кампании и канала считаются раздельно', () => {
  it('воспроизводит расклад SM-15: по каналу 4 лайка, по кампании 3', () => {
    // Как на проде: посты 51, 81, 83 -- соседи по альбому наших публикаций
    // 50, 80, 82; пост 17 опубликован руками мимо системы.
    const rows: ChannelPostRow[] = [
      post(17, '2026-07-31T09:00:00Z', { likes: 1 }),
      post(50, '2026-08-04T14:00:00Z'),
      post(51, '2026-08-04T14:00:01Z', { likes: 1 }),
      post(80, '2026-08-05T11:10:00Z'),
      post(81, '2026-08-05T11:10:01Z', { likes: 1 }),
      post(82, '2026-08-05T19:15:00Z'),
      post(83, '2026-08-05T19:15:01Z', { likes: 1 }),
    ];
    const ours = new Set(['50', '80', '82']);

    const stats = aggregateCampaignChannelPosts(rows, ours);

    expect(stats.likes).toBe(3);
    expect(stats.channelTotals.likes).toBe(4);
    // Публикаций: три наши, четыре в канале (плюс ручная).
    expect(stats.posts).toBe(3);
    expect(stats.channelTotals.posts).toBe(4);
  });

  it('без чужих публикаций обе цифры совпадают — тогда вторую показывать незачем', () => {
    const rows: ChannelPostRow[] = [
      post(50, '2026-08-04T14:00:00Z', { likes: 2, views: 10 }),
      post(80, '2026-08-05T11:10:00Z', { likes: 1, views: 5 }),
    ];
    const stats = aggregateCampaignChannelPosts(rows, new Set(['50', '80']));

    expect(stats.likes).toBe(3);
    expect(stats.channelTotals.likes).toBe(3);
    expect(stats.views).toBe(15);
    expect(stats.channelTotals.views).toBe(15);
  });

  it('расхождение появляется по каждой метрике, а не только по лайкам', () => {
    const rows: ChannelPostRow[] = [
      post(10, '2026-08-01T10:00:00Z', { likes: 5, views: 100, comments: 3, shares: 2 }),
      post(20, '2026-08-02T10:00:00Z', { likes: 1, views: 10, comments: 1, shares: 1 }),
    ];
    const stats = aggregateCampaignChannelPosts(rows, new Set(['20']));

    expect(stats).toMatchObject({ likes: 1, views: 10, comments: 1, shares: 1, posts: 1 });
    expect(stats.channelTotals).toMatchObject({
      likes: 6, views: 110, comments: 4, shares: 3, posts: 2,
    });
  });

  it('в обеих величинах метрики альбома берутся максимумом, а не суммой', () => {
    // Telegram повторяет счётчик просмотров на каждом сообщении альбома:
    // сумма завысила бы канал ровно во столько раз, сколько в альбоме картинок.
    const rows: ChannelPostRow[] = [
      post(30, '2026-08-03T12:00:00Z', { views: 42, likes: 0 }),
      post(31, '2026-08-03T12:00:01Z', { views: 42, likes: 1 }),
    ];

    const ours = aggregateCampaignChannelPosts(rows, new Set(['30']));
    expect(ours.views).toBe(42);
    expect(ours.channelTotals.views).toBe(42);

    // Тот же альбом, но публикация не наша — канал всё равно считает 42.
    const foreign = aggregateCampaignChannelPosts(rows, new Set(['999']));
    expect(foreign.views).toBe(0);
    expect(foreign.channelTotals.views).toBe(42);
    expect(foreign.channelTotals.likes).toBe(1);
  });
});
