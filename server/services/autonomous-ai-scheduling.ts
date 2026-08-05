/**
 * Расписание циклов автономного режима (SM-20).
 *
 * Вынесено в отдельный модуль намеренно: `autonomous-ai.ts` тянет за собой
 * axios, Directus, Gemini и половину сервисного слоя, поэтому любой тест на
 * него требует мокать всю цепочку. Здесь чистая арифметика без зависимостей —
 * её можно проверить напрямую.
 */

export const MIN_CYCLE_DELAY_MS = 5000;

/**
 * Сколько ждать до ближайшего цикла.
 *
 * Правила, ради которых заведён SM-20:
 *  - ждём ОСТАТОК от `lastCycleAt + interval`, а не полный интервал: пауза на
 *    пять минут не должна стоить пользователю ещё сутки ожидания;
 *  - если интервал меняли во время паузы, новый участвует в этом же расчёте,
 *    поэтому правка настроек подхватывается сразу, без отдельной логики;
 *  - если остаток уже истёк (или цикла ещё не было) — выдерживаем минимальную
 *    задержку вместо мгновенного запуска: снятие паузы не должно неожиданно
 *    опубликовать пост в ту же секунду.
 */
export function computeNextCycleDelayMs(
  lastCycleAt: Date | undefined,
  intervalHours: number,
  now: number = Date.now(),
): number {
  if (!lastCycleAt) return MIN_CYCLE_DELAY_MS;
  const intervalMs = intervalHours * 60 * 60 * 1000;
  const remaining = intervalMs - (now - lastCycleAt.getTime());
  return Math.max(MIN_CYCLE_DELAY_MS, remaining);
}
