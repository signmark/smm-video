/**
 * Раскладка публикаций по календарным дням — в ОДНОМ месте и по Москве.
 *
 * SM-9, вторая половина (ревью 2026-07-29). Форматирование времени перевели на
 * московский пояс, а раскладку по дням — нет: календарь и дашборд продолжали
 * сравнивать даты через startOfDay/isSameDay/isToday, то есть по локальной
 * полуночи ЗРИТЕЛЯ. У браузера в UTC публикация 01:00 МСК 29 июля (хранится как
 * 22:00Z 28-го) показывалась с правильным временем, но попадала в клетку 28-го,
 * а в «сегодня» на дашборде не попадала вовсе.
 *
 * Логика жила россыпью прямо в JSX двух больших компонентов, поэтому чинить её
 * там пришлось бы в шести местах и заново при каждой правке. Здесь она чистая
 * функция — её видно, её можно проверить тестом, и обе страницы обязаны звать
 * именно её.
 *
 * Ключевое различие двух видов дат см. в `toWallDateKey`: выбранный в календаре
 * день — это «стена» (что человек видел в клетке), а `scheduledAt`/`publishedAt` —
 * моменты времени. Сравнивать их можно только приведя оба к ключу `YYYY-MM-DD`,
 * каждый своим способом.
 */

import { toDisplayDateKey, toWallDateKey } from './date-utils';

/** Минимум, который нужен раскладке от записи контента. */
export interface PublicationDayInput {
  publishedAt?: string | Date | null;
  scheduledAt?: string | Date | null;
  socialPlatforms?: Record<string, { publishedAt?: string | null; scheduledAt?: string | null } | undefined | null> | null;
}

/**
 * Все московские дни, к которым относится запись: собственные даты плюс
 * платформенные.
 */
export function displayDayKeysOf(post: PublicationDayInput): string[] {
  const keys: string[] = [];

  const push = (value: string | Date | null | undefined) => {
    const key = toDisplayDateKey(value);
    if (key && !keys.includes(key)) keys.push(key);
  };

  push(post.publishedAt);
  push(post.scheduledAt);

  if (post.socialPlatforms && typeof post.socialPlatforms === 'object') {
    for (const platform of Object.keys(post.socialPlatforms)) {
      const data = post.socialPlatforms[platform];
      if (!data) continue;
      push(data.publishedAt);
      push(data.scheduledAt);
    }
  }

  return keys;
}

/** Есть ли у записи вообще хоть одна дата. */
export function hasAnyDisplayDay(post: PublicationDayInput): boolean {
  return displayDayKeysOf(post).length > 0;
}

/**
 * Относится ли запись к выбранному календарному дню.
 *
 * @param wallDateKey день из календаря в виде `YYYY-MM-DD` (см. `toWallDateKey`)
 */
export function matchesDisplayDay(post: PublicationDayInput, wallDateKey: string | null): boolean {
  if (!wallDateKey) return false;
  return displayDayKeysOf(post).includes(wallDateKey);
}

/**
 * Платформы записи, у которых дата попадает на выбранный день.
 *
 * Нужна календарю, чтобы подсветить в карточке только те соцсети, которые в
 * этот день и правда что-то публиковали.
 */
export function platformsOnDisplayDay(post: PublicationDayInput, wallDateKey: string | null): string[] {
  if (!wallDateKey || !post.socialPlatforms) return [];

  const result: string[] = [];
  for (const platform of Object.keys(post.socialPlatforms)) {
    const data = post.socialPlatforms[platform];
    if (!data) continue;
    const hit = toDisplayDateKey(data.publishedAt) === wallDateKey
      || toDisplayDateKey(data.scheduledAt) === wallDateKey;
    if (hit) result.push(platform);
  }
  return result;
}

/** Ключ дня для даты, выбранной пользователем в календаре. */
export { toWallDateKey };
