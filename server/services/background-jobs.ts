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

import { logEvent } from '../utils/logger';

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
/**
 * AI-65. Прогон фоновой задачи под наблюдением.
 *
 * ЧТО БЫЛО. Фоновые задачи писали в журнал только то, что считали нужным сами:
 * одна — строку на каждую кампанию, другая — ничего. Ответить по логам на
 * вопросы «запускалась ли она вообще», «сколько шла» и «упала или отработала»
 * было нельзя. Молчащая задача и здоровая задача выглядели одинаково — а
 * именно так выглядел автономный режим в AI-121 и AI-123.
 *
 * ЧТО ТЕПЕРЬ. Три события с общим `jobId`: начало, окончание с длительностью,
 * отказ с причиной. `jobId` нужен именно потому, что задачи повторяются: без
 * него две строки «задача началась» и одна «закончилась» не связываются.
 *
 * Исключение НЕ пробрасывается. Эти функции вызываются из таймеров, где
 * отказавшее обещание некому поймать: проброс превратил бы сбой одной задачи в
 * падение всего процесса. Причина при этом записана — молчания не остаётся.
 */
let jobRunSeq = 0;

export async function runBackgroundJob<T>(
  name: string,
  job: () => T | Promise<T>,
): Promise<T | undefined> {
  const jobId = `${name}-${++jobRunSeq}`;
  const startedAt = Date.now();

  logEvent('job.started', { operation: name, jobId }, 'debug', 'background-jobs');

  try {
    const result = await job();
    logEvent(
      'job.finished',
      { operation: name, jobId, durationMs: Date.now() - startedAt },
      'info',
      'background-jobs',
    );
    return result;
  } catch (e: any) {
    logEvent(
      'job.failed',
      {
        operation: name,
        jobId,
        durationMs: Date.now() - startedAt,
        // Сообщение ошибки проходит через редакцию и обрезку в logEvent —
        // сюда попадает причина, а не содержимое ответа внешней системы.
        reason: e?.message ? String(e.message) : 'unknown',
      },
      'error',
      'background-jobs',
    );
    return undefined;
  }
}

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
