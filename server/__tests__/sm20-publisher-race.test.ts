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
