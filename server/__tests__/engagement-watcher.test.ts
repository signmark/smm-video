/**
 * diffAndUpdateState — решает, о чём уведомлять владельца кампании.
 *
 * Цена ошибки здесь несимметричная: лишнее событие = спам в Telegram живому человеку,
 * пропущенное = просто тишина. Поэтому тесты давят на «не отправить лишнего»:
 * первый прогон молчит, повторный рост не дублируется, мелкие цифры не всплывают.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  diffAndUpdateState,
  buildNotificationText,
  resetEngagementState,
} from '../services/engagement-watcher';
import type { PostDynamics } from '../services/scraper-analytics';

function post(
  id: string,
  points: Array<{ views: number; comments: number }>,
  overrides: Partial<PostDynamics> = {},
): PostDynamics {
  return {
    platform_post_id: id,
    published_date: '2026-07-20T10:00:00Z',
    data_points: points.map((p, i) => ({
      date: `2026-07-2${i}`,
      views: p.views,
      likes: 0,
      comments: p.comments,
      shares: 0,
      engagement_rate: 0,
    })),
    first_views: points[0]?.views ?? 0,
    current_views: points[points.length - 1]?.views ?? 0,
    views_growth: 0,
    views_growth_percent: 0,
    trend: 'stable',
    ...overrides,
  };
}

beforeEach(() => {
  resetEngagementState();
});

describe('diffAndUpdateState — первый прогон', () => {
  it('на первом проходе молчит: запоминает baseline, не уведомляет о старых постах', () => {
    const events = diffAndUpdateState('campaign-1', 'channel-1', [
      post('1', [{ views: 5000, comments: 42 }]),
    ]);
    expect(events).toEqual([]);
  });

  it('пост, впервые увиденный на втором проходе, тоже не даёт события', () => {
    diffAndUpdateState('campaign-1', 'channel-1', [post('1', [{ views: 1000, comments: 0 }])]);
    const events = diffAndUpdateState('campaign-1', 'channel-1', [
      post('1', [{ views: 1000, comments: 0 }]),
      post('2', [{ views: 9000, comments: 100 }]), // новый пост с кучей комментариев
    ]);
    expect(events).toEqual([]);
  });
});

describe('diffAndUpdateState — комментарии', () => {
  it('рост числа комментариев даёт событие с разницей, а не с полным числом', () => {
    diffAndUpdateState('campaign-1', 'channel-1', [post('1', [{ views: 1000, comments: 3 }])]);
    const events = diffAndUpdateState('campaign-1', 'channel-1', [post('1', [{ views: 1000, comments: 8 }])]);

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('comments');
    expect(events[0].delta).toBe(5);
  });

  it('одно и то же число комментариев не уведомляет повторно', () => {
    diffAndUpdateState('campaign-1', 'channel-1', [post('1', [{ views: 1000, comments: 3 }])]);
    diffAndUpdateState('campaign-1', 'channel-1', [post('1', [{ views: 1000, comments: 8 }])]);
    const third = diffAndUpdateState('campaign-1', 'channel-1', [post('1', [{ views: 1000, comments: 8 }])]);

    expect(third).toEqual([]);
  });

  it('удалённые комментарии не превращаются в отрицательное событие', () => {
    diffAndUpdateState('campaign-1', 'channel-1', [post('1', [{ views: 1000, comments: 10 }])]);
    const events = diffAndUpdateState('campaign-1', 'channel-1', [post('1', [{ views: 1000, comments: 4 }])]);

    expect(events).toEqual([]);
  });
});

describe('diffAndUpdateState — охват', () => {
  it('рост выше порога даёт событие с процентом', () => {
    diffAndUpdateState('campaign-1', 'channel-1', [post('1', [{ views: 1000, comments: 0 }])]);
    const events = diffAndUpdateState('campaign-1', 'channel-1', [post('1', [{ views: 1500, comments: 0 }])]);

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('views');
    expect(events[0].delta).toBe(50);
  });

  it('рост ниже порога молчит', () => {
    diffAndUpdateState('campaign-1', 'channel-1', [post('1', [{ views: 1000, comments: 0 }])]);
    const events = diffAndUpdateState('campaign-1', 'channel-1', [post('1', [{ views: 1100, comments: 0 }])]);

    expect(events).toEqual([]);
  });

  it('пост с малым числом просмотров не всплывает: +100% от 10 просмотров — шум', () => {
    diffAndUpdateState('campaign-1', 'channel-1', [post('1', [{ views: 10, comments: 0 }])]);
    const events = diffAndUpdateState('campaign-1', 'channel-1', [post('1', [{ views: 20, comments: 0 }])]);

    expect(events).toEqual([]);
  });

  it('порог и минимум просмотров настраиваются', () => {
    diffAndUpdateState('campaign-1', 'channel-1', [post('1', [{ views: 100, comments: 0 }])], { minViews: 50 });
    const events = diffAndUpdateState(
      'campaign-1', 'channel-1',
      [post('1', [{ views: 110, comments: 0 }])],
      { spikePercent: 5, minViews: 50 },
    );

    expect(events).toHaveLength(1);
    expect(events[0].delta).toBe(10);
  });
});

describe('diffAndUpdateState — изоляция каналов', () => {
  it('состояние одного канала не влияет на другой', () => {
    diffAndUpdateState('campaign-1', 'channel-1', [post('1', [{ views: 1000, comments: 0 }])]);
    // channel-2 видим впервые — молчит, даже если id поста совпадает
    const events = diffAndUpdateState('campaign-1', 'channel-2', [post('1', [{ views: 9000, comments: 50 }])]);

    expect(events).toEqual([]);
  });
});

describe('buildNotificationText', () => {
  it('склоняет комментарии по-русски', () => {
    const one = buildNotificationText('Кампания', [
      { kind: 'comments', post: post('1', [{ views: 1, comments: 1 }]), delta: 1 },
    ]);
    const few = buildNotificationText('Кампания', [
      { kind: 'comments', post: post('1', [{ views: 1, comments: 1 }]), delta: 3 },
    ]);
    const many = buildNotificationText('Кампания', [
      { kind: 'comments', post: post('1', [{ views: 1, comments: 1 }]), delta: 11 },
    ]);

    expect(one).toContain('1 новый комментарий');
    expect(few).toContain('3 новых комментария');
    expect(many).toContain('11 новых комментариев');
  });

  it('экранирует название кампании — оно приходит от пользователя', () => {
    const text = buildNotificationText('<b>взлом</b>', [
      { kind: 'views', post: post('1', [{ views: 1, comments: 0 }]), delta: 40 },
    ]);

    expect(text).toContain('&lt;b&gt;взлом&lt;/b&gt;');
    expect(text).not.toContain('<b>взлом</b>');
  });
});
