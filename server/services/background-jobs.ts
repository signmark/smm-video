/**
 * Выключатель фоновых задач (AI-36).
 *
 * Планировщик публикаций, валидатор статусов, восстановление автономных
 * кампаний и телеграм-бот стартуют в `server/index.ts` безусловно. Пока
 * экземпляр приложения ровно один, это незаметно. Как только рядом
 * поднимается второй с тем же окружением — а именно это делает `webServer`
 * в `playwright.config.ts`, если не задан `PLAYWRIGHT_BASE_URL`, — на одной
 * базе оказываются два планировщика и два бота. Симптом наружу: дубли
 * публикаций в боевых кампаниях.
 *
 * Поэтому выключатель, а не «не запускайте так»: инструкцию можно забыть,
 * переменную окружения стенд задаёт один раз.
 *
 * Флаг снимает ТОЛЬКО фоновую активность. HTTP, авторизация и API работают
 * как обычно — иначе E2E нечего было бы тестировать.
 */

/** Значения, которые считаем «выключено», чтобы `DISABLE_BACKGROUND_JOBS=false` не включал режим. */
const FALSY = new Set(['', '0', 'false', 'no', 'off']);

export function backgroundJobsDisabled(): boolean {
  const raw = process.env.DISABLE_BACKGROUND_JOBS;
  if (raw === undefined || raw === null) return false;
  return !FALSY.has(String(raw).trim().toLowerCase());
}

/**
 * Отложенный запуск фоновой задачи с учётом выключателя.
 *
 * Возвращает таймер или `null`, если задача не планировалась — по этому
 * значению тест и отличает «запустили» от «пропустили», не полагаясь на
 * побочные эффекты.
 */
export function scheduleBackgroundJob(
  name: string,
  delayMs: number,
  job: () => void | Promise<void>,
  log: (message: string) => void = () => {},
): ReturnType<typeof setTimeout> | null {
  if (backgroundJobsDisabled()) {
    log(`[background-jobs] ${name}: пропущен, DISABLE_BACKGROUND_JOBS активен`);
    return null;
  }
  return setTimeout(job, delayMs);
}
