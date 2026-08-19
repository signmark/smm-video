/**
 * SM-15, решение владельца 19.08: подсказка у второй цифры называет кампании.
 *
 * ЧТО БЫЛО. Рядом с метрикой кампании стояла цифра «по каналу», а разница
 * между ними ничем не объяснялась: соседняя кампания в том же канале, ручная
 * публикация и наш же пост с потерянным идентификатором выглядели одинаково.
 * Подпись перечисляла все три источника словами, но не говорила, сколько
 * приходится на каждый и как называются соседи.
 */
import { describe, it, expect } from 'vitest';
import {
  channelBreakdownParts,
  hasMeaningfulBreakdown,
  type ChannelAttribution,
} from '../channel-breakdown';

const ATTRIBUTION: ChannelAttribution = {
  campaignName: 'Летняя',
  own: { posts: 3, views: 100, likes: 5, comments: 2, shares: 1 },
  others: [
    { campaignId: 'a', name: 'Осенняя', posts: 2, views: 40, likes: 0, comments: 0, shares: 0 },
    { campaignId: 'b', name: 'Зимняя', posts: 1, views: 60, likes: 1, comments: 0, shares: 0 },
  ],
  unattributed: { posts: 1, views: 7, likes: 0, comments: 0, shares: 0 },
};

describe('SM-15: разложение цифры по каналу', () => {
  it('называет текущую кампанию и соседей поимённо', () => {
    const parts = channelBreakdownParts('views', ATTRIBUTION);

    expect(parts.map(p => p.kind)).toEqual(['own', 'other', 'other', 'unattributed']);
    expect(parts.map(p => ('name' in p ? p.name : 'без привязки')))
      .toEqual(['Летняя', 'Зимняя', 'Осенняя', 'без привязки']);
  });

  it('слагаемые идут от большего к меньшему, своя кампания — первой', () => {
    // Своя всегда первая: человек смотрит на свою цифру, остальное — контекст.
    const parts = channelBreakdownParts('views', ATTRIBUTION);
    expect(parts.map(p => p.value)).toEqual([100, 60, 40, 7]);
  });

  it('нулевые слагаемые не показываются', () => {
    // «0 — кампания „Осенняя“» ничего не объясняет и вытесняет то, что объясняет.
    const parts = channelBreakdownParts('likes', ATTRIBUTION);
    expect(parts.map(p => ('name' in p ? p.name : 'без привязки'))).toEqual(['Летняя', 'Зимняя']);
  });

  it('когда всё число — наше, объяснять нечего', () => {
    const onlyOurs: ChannelAttribution = {
      campaignName: 'Летняя',
      own: { posts: 3, views: 100, likes: 5, comments: 2, shares: 1 },
      others: [],
      unattributed: { posts: 0, views: 0, likes: 0, comments: 0, shares: 0 },
    };

    expect(hasMeaningfulBreakdown('views', onlyOurs)).toBe(false);
    expect(hasMeaningfulBreakdown('views', ATTRIBUTION)).toBe(true);
  });

  it('без разложения — пусто, а не выдуманные слагаемые', () => {
    expect(channelBreakdownParts('views', undefined)).toEqual([]);
    expect(hasMeaningfulBreakdown('views', undefined)).toBe(false);
  });

  it('разложение считается по каждой метрике отдельно', () => {
    // Иначе цифры в подсказке не сойдутся с той, что стоит рядом с метрикой.
    const shares = channelBreakdownParts('shares', ATTRIBUTION);
    expect(shares).toEqual([{ kind: 'own', name: 'Летняя', value: 1 }]);
    expect(hasMeaningfulBreakdown('shares', ATTRIBUTION)).toBe(false);
  });
});
