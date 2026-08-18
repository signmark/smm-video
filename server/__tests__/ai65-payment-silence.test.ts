/**
 * AI-65: молчание на пути оплаты стоит человеку дороже всего.
 *
 * ЧТО БЫЛО. В обработке платежей три ветки глотали отказ пустым `catch (_) {}`.
 * Все три не должны ронять платёж — деньги приняты, тариф выдан, а возврат 500
 * провайдеру заставил бы его повторять уведомление. Но все три означают, что
 * человек чего-то не получил, и ни одна не оставляла следа:
 *
 *  - подтверждение оплаты не доставлено: человек заплатил и не знает, прошло ли;
 *  - адрес для чека по 54-ФЗ не выяснен: чек уйдёт в никуда;
 *  - партнёрская отметка о покупке потеряна: партнёру не доплатили.
 *
 * ВНИМАНИЕ (правило 49). Это сканер исходника. Вызвать эти ветки в тесте значит
 * поднять маршрут оплаты с провайдером и Directus целиком — цена не оправдана.
 * Сканер стережёт ровно то, что здесь важно: что молчание больше не пустое, что
 * ветка по-прежнему не бросает, и что причина названа стабильным именем.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = () => readFileSync(join(__dirname, '../routes/yookassa.ts'), 'utf-8');

/** Тело catch-блока, следующего за указанным событием. */
function eventCall(name: string): string {
  const s = src();
  const idx = s.indexOf(`'${name}'`);
  expect(idx, name).toBeGreaterThan(0);
  return s.slice(idx, idx + 400);
}

describe('AI-65: на пути оплаты не осталось пустых catch', () => {
  it('пустых catch нет вовсе', () => {
    // `catch (_) {}` здесь означал отказ, о котором не узнает никто: ни человек,
    // ни мы. Платёж при этом состоялся.
    expect(src()).not.toMatch(/catch \(_\) \{\}/);
    expect(src()).not.toContain('catch {}');
  });
});

describe('AI-65: каждое молчание названо и объяснено', () => {
  it('подтверждение оплаты не доставлено', () => {
    const call = eventCall('payment.confirmation_undelivered');
    expect(call).toContain('userId');
    // Предупреждение, а не ошибка: подписка активирована, продукт работает.
    expect(call).toContain("'warn'");
  });

  it('адрес для чека не выяснен', () => {
    const call = eventCall('payment.receipt_email_unresolved');
    expect(call).toContain('userId');
    expect(call).toContain("'warn'");
  });

  it('партнёрская отметка не отправлена', () => {
    const call = eventCall('payment.partner_postback_failed');
    expect(call).toContain('userId');
    expect(call).toContain("'warn'");
  });
});

describe('AI-65: платёж всё так же не падает из-за второстепенного', () => {
  it('ни одна из трёх веток не бросает дальше', () => {
    const s = src();
    for (const name of [
      'payment.confirmation_undelivered',
      'payment.receipt_email_unresolved',
      'payment.partner_postback_failed',
    ]) {
      const idx = s.indexOf(`'${name}'`);
      const tail = s.slice(idx, idx + 500);
      // Проброс здесь вернул бы провайдеру 500, и он начал бы повторять
      // уведомление об уже принятом платеже.
      expect(tail, name).not.toMatch(/\bthrow\b/);
    }
  });

  it('в событие не попадает содержимое ответа платёжной системы', () => {
    const s = src();
    for (const name of [
      'payment.confirmation_undelivered',
      'payment.receipt_email_unresolved',
      'payment.partner_postback_failed',
    ]) {
      const idx = s.indexOf(`'${name}'`);
      const tail = s.slice(idx, idx + 400);
      // Только стабильная причина из сообщения ошибки — не тело ответа и не
      // сам объект платежа.
      expect(tail, name).toContain('reason:');
      expect(tail, name).not.toContain('JSON.stringify');
    }
  });
});
