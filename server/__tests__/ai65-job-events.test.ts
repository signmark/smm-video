/**
 * AI-65: фоновая задача обязана оставлять след.
 *
 * ЧТО БЫЛО. Фоновые задачи писали в журнал только то, что считали нужным сами:
 * одна — строку на каждую кампанию, другая — вообще ничего. Ответить по логам
 * на вопросы «запускалась ли она», «сколько шла», «упала или отработала» было
 * нельзя. Молчащая задача и здоровая задача выглядят одинаково — ровно так
 * выглядел автономный режим в AI-121 и AI-123, пока не появились события.
 *
 * ЧТО ПРОВЕРЯЕТСЯ. Первая часть — поведение обёртки: события, длительность,
 * связь прогона по `jobId` и то, что отказ задачи не выносится в таймер.
 * Вторая — сканер (правило 49): он стережёт места подключения обёртки.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { logEvent, EVENT_FIELD_ALLOWLIST } from '../utils/logger';
import { runBackgroundJob } from '../services/background-jobs';

vi.mock('../utils/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/logger')>();
  return { ...actual, logEvent: vi.fn() };
});

const mockLogEvent = logEvent as unknown as ReturnType<typeof vi.fn>;

/** События одного вида, записанные за тест. */
function events(name: string): Array<Record<string, any>> {
  return mockLogEvent.mock.calls
    .filter((call) => call[0] === name)
    .map((call) => call[1] as Record<string, any>);
}

beforeEach(() => {
  mockLogEvent.mockReset();
});

describe('AI-65: прогон фоновой задачи виден целиком', () => {
  it('успешный прогон: начало и окончание с длительностью', async () => {
    const result = await runBackgroundJob('vk-tokens-status', async () => 'сделано');

    expect(result).toBe('сделано');
    expect(events('job.started')).toHaveLength(1);
    expect(events('job.finished')).toHaveLength(1);

    const finished = events('job.finished')[0];
    expect(finished.operation).toBe('vk-tokens-status');
    expect(typeof finished.durationMs).toBe('number');
    expect(finished.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('начало и окончание одного прогона связаны идентификатором', async () => {
    await runBackgroundJob('vk-tokens-status', () => undefined);

    // Задачи повторяются. Без общего идентификатора две строки «началась» и
    // одна «закончилась» не складываются в историю конкретного прогона.
    expect(events('job.started')[0].jobId).toBe(events('job.finished')[0].jobId);
  });

  it('разные прогоны одной задачи различимы', async () => {
    await runBackgroundJob('vk-tokens-status', () => undefined);
    await runBackgroundJob('vk-tokens-status', () => undefined);

    const [first, second] = events('job.started');
    expect(first.jobId).not.toBe(second.jobId);
  });
});

describe('AI-65: отказ задачи записан, но процесс не роняет', () => {
  it('пишет причину и возвращает undefined вместо исключения', async () => {
    const result = await runBackgroundJob('vk-tokens-refresh', async () => {
      throw new Error('Directus не ответил');
    });

    // Обёртка вызывается из таймера, где отказавшее обещание некому поймать.
    // Проброс превратил бы сбой одной задачи в падение всего процесса.
    expect(result).toBeUndefined();

    const failed = events('job.failed');
    expect(failed).toHaveLength(1);
    expect(failed[0].operation).toBe('vk-tokens-refresh');
    expect(failed[0].reason).toContain('Directus не ответил');
    expect(typeof failed[0].durationMs).toBe('number');
    // Отказ не должен выглядеть как успешное завершение.
    expect(events('job.finished')).toHaveLength(0);
  });

  it('отказ без сообщения тоже имеет причину', async () => {
    await runBackgroundJob('vk-tokens-refresh', async () => {
      throw 'строка вместо ошибки';
    });

    expect(events('job.failed')[0].reason).toBe('unknown');
  });
});

describe('AI-65: поля событий', () => {
  it('идентификатор прогона разрешён к записи', () => {
    // Иначе фильтр полей вырежет его молча, и связь прогона потеряется.
    expect(EVENT_FIELD_ALLOWLIST).toContain('jobId');
  });
});

describe('AI-65: подключение обёртки и событие истекающего токена', () => {
  const indexSrc = () => readFileSync(join(__dirname, '../index.ts'), 'utf-8');

  it('обе проверки VK-токенов идут через обёртку — и первый запуск, и повторы', () => {
    const s = indexSrc();
    // Повторный запуск важнее первого: именно он идёт бесконечно, и именно он
    // раньше не оставлял следа.
    expect(s).toContain("setInterval(() => void runBackgroundJob('vk-tokens-status'");
    expect(s).toContain("runBackgroundJob('vk-tokens-refresh'");
  });

  it('истекающий токен площадки — событие, а не строка текста', () => {
    const s = indexSrc();
    const idx = s.indexOf("'platform.token_expiring'");
    expect(idx).toBeGreaterThan(0);

    const around = s.slice(idx, idx + 300);
    // По кампании и площадке событие можно посчитать и отследить рост —
    // истекающий токен это потеря возможности публиковать без всякого сигнала.
    expect(around).toContain('campaignId');
    expect(around).toContain("provider: 'vk'");
  });
});
