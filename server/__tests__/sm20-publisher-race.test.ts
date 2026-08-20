/**
 * SM-20, фаза 2 (B). Гонка «пауза против публикатора».
 *
 * Планировщик выбирает пачку, проходит защиты, берёт блокировки и только потом
 * отправляет. Между выборкой и отправкой проходит время — там и живёт беда:
 * человек нажал паузу, публикация снята с очереди, а пост всё равно вышел.
 * Именно про это писал тестировщик.
 *
 * Взаимное исключение держится на той же блокировке, которой пользуется сам
 * публикатор, а последняя проверка статуса закрывает остаток окна.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { isPublishableStatus, PUBLISHABLE_STATUSES } from '../services/publish-scheduler';

describe('после снятия с очереди публикация недостижима', () => {
  it('черновик не публикуется', () => {
    // Ровно то, во что пауза переводит свои публикации.
    expect(isPublishableStatus('draft')).toBe(false);
  });

  it('всё, что стоит в очереди, публикуется по-прежнему', () => {
    for (const status of PUBLISHABLE_STATUSES) {
      expect(isPublishableStatus(status)).toBe(true);
    }
  });

  it('набор публикуемых статусов совпадает с выборкой планировщика', () => {
    // Если наборы разойдутся, проверка перед отправкой начнёт либо пропускать
    // то, что выбрано, либо публиковать то, что выбрано не было.
    expect([...PUBLISHABLE_STATUSES]).toEqual(['scheduled', 'partial', 'pending', 'partially_published']);
  });

  it('опубликованное и удалённое повторно не отправляются', () => {
    expect(isPublishableStatus('published')).toBe(false);
    expect(isPublishableStatus(null)).toBe(false);
    expect(isPublishableStatus(undefined)).toBe(false);
  });

  it('неизвестный статус трактуется как «не публиковать»', () => {
    // Список закрытый: новый статус обязан быть добавлен осознанно, иначе
    // публикация уедет по недосмотру.
    expect(isPublishableStatus('archived')).toBe(false);
    expect(isPublishableStatus('')).toBe(false);
  });
});

/**
 * Граница «цикл → отправка».
 *
 * Сам цикл поднять в тесте нельзя: он тянет отбор пачки, время, квоты и шесть
 * уровней защиты. Поэтому здесь узкая проверка по исходнику: рабочий цикл
 * обязан идти через runPublicationJob и не звать отправку напрямую в обход
 * проверки статуса. Поведение самого runPublicationJob исполнимо проверено в
 * sm20-publisher-race-path.test.ts.
 */
describe('рабочий цикл не публикует в обход проверки статуса', () => {
  const sourceOfScheduler = readFileSync(
    resolve(__dirname, '../services/publish-scheduler.ts'),
    'utf-8'
  );

  function publicationWorkerBody(): string {
    const start = sourceOfScheduler.indexOf('const runPublicationWorker = async () => {');
    expect(start, 'рабочий цикл публикаций не найден').toBeGreaterThan(-1);
    const end = sourceOfScheduler.indexOf('await Promise.all(', start);
    return sourceOfScheduler.slice(start, end);
  }

  it('цикл вызывает runPublicationJob', () => {
    expect(publicationWorkerBody()).toContain('this.runPublicationJob(content, platforms)');
  });

  it('цикл не зовёт отправку напрямую', () => {
    // Прямой вызов вернул бы ровно ту ошибку, о которой писал тестировщик:
    // пост уходит уже после того, как его сняли с очереди.
    expect(publicationWorkerBody()).not.toContain('publishContentToPlatforms');
  });

  it('проверка статуса стоит до отправки, а не после', () => {
    const job = sourceOfScheduler.slice(
      sourceOfScheduler.indexOf('async runPublicationJob(')
    );
    const guard = job.indexOf('isStillPublishable');
    const send = job.indexOf('publishContentToPlatforms');
    expect(guard).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(send);
  });
});
