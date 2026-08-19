/**
 * SM-15, решение владельца 19.08: «Хорошо бы написать, посты из какой кампании
 * учтены».
 *
 * ЧТО БЫЛО. Рядом с метрикой кампании стояла вторая цифра — по всему каналу.
 * Разница между ними была одним безымянным числом: понять, чья это активность
 * (соседней кампании в том же канале, ручной публикации или нашей же
 * публикации с потерянным идентификатором поста), человек не мог.
 *
 * Замер по боевой базе перед этой правкой: шесть телеграм-каналов ведут по
 * две-три кампании сразу — то есть главный источник расхождения именно
 * соседние кампании, а не ручные посты.
 */
import { describe, it, expect } from 'vitest';
import {
  aggregateCampaignChannelPosts,
  type ChannelPostRow,
  type SiblingCampaign,
} from '../services/analytics-aggregation';

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

const AUTUMN: SiblingCampaign = {
  campaignId: 'camp-autumn',
  name: 'Осенняя распродажа',
  expectedIds: new Set(['70', '71']),
};

describe('SM-15: разница «канал минус кампания» разложена по кампаниям', () => {
  it('называет соседнюю кампанию, чьи публикации попали в канал', () => {
    const rows: ChannelPostRow[] = [
      post(50, '2026-08-04T14:00:00Z', { views: 100, likes: 5 }),
      post(70, '2026-08-05T10:00:00Z', { views: 40, likes: 2 }),
      post(71, '2026-08-06T10:00:00Z', { views: 60, likes: 1 }),
    ];

    const stats = aggregateCampaignChannelPosts(rows, new Set(['50']), [AUTUMN]);

    expect(stats.views).toBe(100);
    expect(stats.channelTotals.views).toBe(200);
    expect(stats.attribution?.others).toEqual([
      {
        campaignId: 'camp-autumn',
        name: 'Осенняя распродажа',
        posts: 2,
        views: 100,
        likes: 3,
        comments: 0,
        shares: 0,
      },
    ]);
  });

  it('ничьи публикации остаются отдельной величиной, а не приписываются соседям', () => {
    // Ручная публикация и наша же с потерянным идентификатором выглядят из
    // канала одинаково. Приписать их какой-либо кампании значило бы выдумать.
    const rows: ChannelPostRow[] = [
      post(50, '2026-08-04T14:00:00Z', { views: 100 }),
      post(70, '2026-08-05T10:00:00Z', { views: 40 }),
      post(99, '2026-08-07T10:00:00Z', { views: 7 }),
    ];

    const stats = aggregateCampaignChannelPosts(rows, new Set(['50']), [AUTUMN]);

    expect(stats.attribution?.unattributed).toEqual({
      posts: 1, views: 7, likes: 0, comments: 0, shares: 0,
    });
  });

  it('сумма разложения сходится с цифрой по каналу — иначе числа врут', () => {
    const rows: ChannelPostRow[] = [
      post(50, '2026-08-04T14:00:00Z', { views: 100, likes: 5, comments: 2, shares: 1 }),
      post(70, '2026-08-05T10:00:00Z', { views: 40, likes: 2, comments: 1, shares: 0 }),
      post(99, '2026-08-07T10:00:00Z', { views: 7, likes: 1, comments: 0, shares: 3 }),
    ];

    const stats = aggregateCampaignChannelPosts(rows, new Set(['50']), [AUTUMN]);
    const others = stats.attribution!.others;
    const un = stats.attribution!.unattributed;

    (['posts', 'views', 'likes', 'comments', 'shares'] as const).forEach(key => {
      const sum = stats[key] + others.reduce((acc, o) => acc + o[key], 0) + un[key];
      expect(sum).toBe(stats.channelTotals[key]);
    });
  });

  it('соседних кампаний нет — разложения нет вовсе', () => {
    // Пустой блок в интерфейсе читался бы как «данные пропали», а «остальное»
    // без списка соседей означает просто «не наше» и ничего не объясняет.
    const rows: ChannelPostRow[] = [post(50, '2026-08-04T14:00:00Z', { views: 10 })];

    const stats = aggregateCampaignChannelPosts(rows, new Set(['50']));

    expect(stats.attribution).toBeUndefined();
  });

  it('соседняя кампания без публикаций за период в разложение не попадает', () => {
    const rows: ChannelPostRow[] = [post(50, '2026-08-04T14:00:00Z', { views: 10 })];

    const stats = aggregateCampaignChannelPosts(rows, new Set(['50']), [AUTUMN]);

    expect(stats.attribution?.others).toEqual([]);
    expect(stats.attribution?.unattributed.posts).toBe(0);
  });

  it('кампании в разложении идут от самой заметной к самой мелкой', () => {
    const winter: SiblingCampaign = {
      campaignId: 'camp-winter',
      name: 'Зимняя',
      expectedIds: new Set(['80', '81', '82']),
    };
    const rows: ChannelPostRow[] = [
      post(50, '2026-08-04T14:00:00Z'),
      post(70, '2026-08-05T10:00:00Z'),
      post(80, '2026-08-06T10:00:00Z'),
      post(81, '2026-08-07T10:00:00Z'),
      post(82, '2026-08-08T10:00:00Z'),
    ];

    const stats = aggregateCampaignChannelPosts(rows, new Set(['50']), [AUTUMN, winter]);

    expect(stats.attribution?.others.map(o => o.name)).toEqual(['Зимняя', 'Осенняя распродажа']);
  });

  it('публикация нашей кампании не уходит соседу, даже если идентификаторы пересеклись', () => {
    // Приоритет у своей кампании: иначе собственные посты исчезали бы из
    // своей же аналитики при любой путанице в идентификаторах.
    const overlapping: SiblingCampaign = {
      campaignId: 'camp-x',
      name: 'Пересекающаяся',
      expectedIds: new Set(['50']),
    };
    const rows: ChannelPostRow[] = [post(50, '2026-08-04T14:00:00Z', { views: 10 })];

    const stats = aggregateCampaignChannelPosts(rows, new Set(['50']), [overlapping]);

    expect(stats.views).toBe(10);
    expect(stats.attribution?.others).toEqual([]);
  });

  it('альбом соседней кампании считается одной публикацией, а не тремя', () => {
    // Telegram повторяет счётчик просмотров на каждом сообщении альбома —
    // суммирование раздуло бы чужую долю втрое.
    const rows: ChannelPostRow[] = [
      post(50, '2026-08-04T14:00:00Z', { views: 10 }),
      post(70, '2026-08-05T10:00:00Z', { views: 40 }),
      post(71, '2026-08-05T10:00:01Z', { views: 40 }),
    ];

    const stats = aggregateCampaignChannelPosts(rows, new Set(['50']), [AUTUMN]);

    expect(stats.attribution?.others[0]).toMatchObject({ posts: 1, views: 40 });
  });
});
