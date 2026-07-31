/**
 * Выключатель фоновых задач (AI-36).
 *
 * Планировщик публикаций, валидатор статусов и телеграм-бот стартуют
 * безусловно. Второй экземпляр приложения на том же окружении означает два
 * планировщика и двух ботов на одной базе — то есть дубли публикаций в живых
 * кампаниях. Ровно такой второй экземпляр поднимает `webServer` из
 * `playwright.config.ts`, если забыть `PLAYWRIGHT_BASE_URL`.
 *
 * Здесь закреплено, что выключатель действительно не даёт задаче стартовать,
 * и — не менее важно — что без флага поведение прежнее: тихо отключить
 * планировщик на проде было бы хуже, чем не иметь флага вовсе.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { backgroundJobsDisabled, scheduleBackgroundJob } from '../services/background-jobs';

const original = process.env.DISABLE_BACKGROUND_JOBS;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  if (original === undefined) delete process.env.DISABLE_BACKGROUND_JOBS;
  else process.env.DISABLE_BACKGROUND_JOBS = original;
});

describe('backgroundJobsDisabled', () => {
  it('по умолчанию фоновые задачи включены', () => {
    delete process.env.DISABLE_BACKGROUND_JOBS;
    expect(backgroundJobsDisabled()).toBe(false);
  });

  it.each(['1', 'true', 'yes', 'TRUE', ' on '])('включается значением %s', (value) => {
    process.env.DISABLE_BACKGROUND_JOBS = value;
    expect(backgroundJobsDisabled()).toBe(true);
  });

  // Отдельно: строка 'false' истинна в JS, и наивная проверка сделала бы из неё
  // «выключено». Тот же класс ошибки уже стоил приёмки в AI-39.
  it.each(['', '0', 'false', 'no', 'off', 'FALSE'])('НЕ включается значением %s', (value) => {
    process.env.DISABLE_BACKGROUND_JOBS = value;
    expect(backgroundJobsDisabled()).toBe(false);
  });
});

describe('scheduleBackgroundJob', () => {
  it('без флага задача запускается по таймеру', () => {
    delete process.env.DISABLE_BACKGROUND_JOBS;
    const job = vi.fn();

    const timer = scheduleBackgroundJob('test-job', 5000, job);

    expect(timer).not.toBeNull();
    expect(job).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(job).toHaveBeenCalledTimes(1);
  });

  it('с флагом задача не планируется вовсе', () => {
    process.env.DISABLE_BACKGROUND_JOBS = '1';
    const job = vi.fn();

    const timer = scheduleBackgroundJob('test-job', 5000, job);

    // null — это и есть наблюдаемый признак «не планировали»: проверять только
    // отсутствие вызова мало, таймер мог бы висеть и выстрелить позже.
    expect(timer).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(job).not.toHaveBeenCalled();
  });

  it('пропуск сообщается в лог, а не молчит', () => {
    process.env.DISABLE_BACKGROUND_JOBS = '1';
    const log = vi.fn();

    scheduleBackgroundJob('publish-scheduler', 1000, () => {}, log);

    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain('publish-scheduler');
  });

  it('решение принимается на момент вызова, а не на импорт модуля', () => {
    delete process.env.DISABLE_BACKGROUND_JOBS;
    const first = vi.fn();
    expect(scheduleBackgroundJob('a', 10, first)).not.toBeNull();

    process.env.DISABLE_BACKGROUND_JOBS = '1';
    const second = vi.fn();
    expect(scheduleBackgroundJob('b', 10, second)).toBeNull();

    vi.advanceTimersByTime(1000);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });
});

/**
 * Проверка проводки, а не поведения.
 *
 * Модуль выше протестирован сам по себе, но это не доказывает, что
 * `server/index.ts` им пользуется: можно починить выключатель и оставить
 * фоновые задачи на голом setTimeout. Импортировать index.ts нельзя — он на
 * импорте поднимает сервер, поэтому проверяем исходник.
 *
 * Способ грубый, и это осознанно: единственная альтернатива — вынести запуск
 * фоновых задач в отдельный модуль и тестировать его, что означает более
 * крупную перестройку index.ts. Пока задачи стартуют прямо там, лучше грубая
 * проверка, чем никакой: цена пропуска — дубли публикаций в живых кампаниях.
 */
describe('проводка в server/index.ts', () => {
  const source = readFileSync(path.resolve(__dirname, '../index.ts'), 'utf8');

  it.each([
    'restore-autonomous',
    'status-validator',
    'publish-scheduler',
    'telegram-bot',
    // Приёмка инкремента 1: эти две жили мимо выключателя. vk-tokens-refresh —
    // единственная фоновая задача, которая ПИШЕТ во внешнюю систему: два
    // экземпляра начнут наперегонки ротировать VK-токены, и проигравший
    // останется с недействительным.
    'vk-tokens-status',
    'vk-tokens-refresh',
  ])('фоновая задача %s проходит через выключатель', (name) => {
    expect(source).toContain(`scheduleBackgroundJob('${name}'`);
  });

  it('engagement-watcher перекрыт общим выключателем, а не только своим флагом', () => {
    // У наблюдателя есть ENGAGEMENT_WATCH_ENABLED, но полагаться на два
    // независимых флага в стендовом env — способ забыть один.
    const at = source.indexOf('startEngagementWatcher');
    expect(at).toBeGreaterThan(-1);
    expect(source.slice(Math.max(0, at - 600), at)).toContain('backgroundJobsDisabled()');
  });

  it('VK-задачи не остались на голом setTimeout', () => {
    // Внешний таймер заворачивается целиком: пропущен он — внутренний
    // setInterval не заводится вовсе.
    expect(source).not.toContain('setTimeout(() => {\n  checkVkTokensStatus();');
  });

  it('запуск планировщика и бота не остался на голом setTimeout', () => {
    // Точечно: именно эти две задачи публикуют наружу, остальные дешевле.
    // Якорь именно на вызов, а не на первое вхождение строки: выше есть
    // импорт ./services/publish-scheduler, и поиск по подстроке цеплялся за него.
    const schedulerAt = source.indexOf("scheduleBackgroundJob('publish-scheduler'");
    expect(schedulerAt).toBeGreaterThan(-1);
    const schedulerBlock = source.slice(schedulerAt, schedulerAt + 400);
    expect(schedulerBlock).toContain('scheduler.start()');

    const botBlock = source.slice(
      source.indexOf("scheduleBackgroundJob('telegram-bot'"),
      source.indexOf("scheduleBackgroundJob('telegram-bot'") + 400,
    );
    expect(botBlock).toContain('startTelegramBot()');
  });
});
