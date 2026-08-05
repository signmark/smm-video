// SM-17: раздела закладок в интерфейсе не существовало — положить тренд в
// закладки было можно, а посмотреть отложенное негде. Фильтр добавлен в
// useVisibleTrends; здесь закреплён его предикат.
//
// Тестируется чистая функция, а не хук: инфраструктуры для тестов React-хуков
// в проекте нет (AI-39), и заводить её ради одного предиката несоразмерно.
import { describe, it, expect } from 'vitest';
import { isBookmarkedTrend } from '../useVisibleTrends';

describe('isBookmarkedTrend (SM-17)', () => {
  it('читает snake_case из Directus', () => {
    expect(isBookmarkedTrend({ is_bookmarked: true })).toBe(true);
    expect(isBookmarkedTrend({ is_bookmarked: false })).toBe(false);
  });

  it('читает camelCase из клиентских мутаций', () => {
    expect(isBookmarkedTrend({ isBookmarked: true })).toBe(true);
    expect(isBookmarkedTrend({ isBookmarked: false })).toBe(false);
  });

  it('оба написания вместе: достаточно одного true', () => {
    expect(isBookmarkedTrend({ is_bookmarked: false, isBookmarked: true })).toBe(true);
  });

  // Ключевое. Тренд без признака закладки НЕ должен считаться отложенным:
  // иначе фильтр «только закладки» молча покажет весь список, и баг из SM-17
  // вернётся в другом виде — раздел есть, но он бесполезен.
  it('отсутствие признака — это НЕ закладка', () => {
    expect(isBookmarkedTrend({})).toBe(false);
    expect(isBookmarkedTrend({ is_bookmarked: undefined })).toBe(false);
    expect(isBookmarkedTrend({ is_bookmarked: null })).toBe(false);
  });

  // Directus умеет отдавать строки вместо булевых — строка "true" не булев true.
  it('строки не считаются закладкой', () => {
    expect(isBookmarkedTrend({ is_bookmarked: 'true' })).toBe(false);
    expect(isBookmarkedTrend({ isBookmarked: '1' })).toBe(false);
  });

  it('не падает на мусорном входе', () => {
    expect(isBookmarkedTrend(null)).toBe(false);
    expect(isBookmarkedTrend(undefined)).toBe(false);
  });
});
