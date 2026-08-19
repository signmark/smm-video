/**
 * Слияние состояния площадки при записи итога публикации.
 *
 * Зачем отдельно. Запись велась простым разворотом `{...прежнее, ...новое}`, и
 * следы неудачной попытки переживали успешную: у поста стоял статус
 * «опубликовано», рядом лежал `lastError` от прошлого раза, и карточка публикации
 * показывала человеку красную ошибку под зелёной отметкой. 19.08 владелец на
 * этом основании сообщил, что «ошибки посыпались», хотя все три площадки к тому
 * моменту опубликовали.
 *
 * Правило простое: успех стирает следы неудачи, неудача ничего не стирает.
 */

/** Поля, которые описывают неудачную попытку и после успеха лгут. */
const FAILURE_FIELDS = [
  'error',
  'lastError',
  'failedAt',
  'retryCount',
  'retriedAt',
  'publishingAt',
] as const;

/**
 * `scheduledAt` намеренно не трогаем: это же поле означает запланированное
 * человеком время публикации, а не только время следующей попытки.
 */
export function mergePlatformStatus(
  previous: Record<string, any> | undefined | null,
  incoming: Record<string, any>,
): Record<string, any> {
  const merged: Record<string, any> = { ...(previous || {}), ...incoming };
  if (incoming.status !== 'published') return merged;
  for (const field of FAILURE_FIELDS) {
    // Стираем только унаследованное: если новая запись сама принесла значение,
    // это осознанный выбор вызывающего кода.
    if (!(field in incoming)) delete merged[field];
  }
  return merged;
}
