/**
 * AI-41, вторая половина: в логах нет персональных данных.
 *
 * Замер боевых логов 17.08.2026: за сутки 40 строк содержали адрес почты
 * пользователя. Секретов — токенов, паролей, ключей — не нашлось: их уже режет
 * существующая редакция. А почту она не ловила, потому что это не секрет:
 * у адреса нет ни имени параметра, ни кавычек, для правил редакции он обычное
 * слово.
 *
 * Закрыто с двух сторон. Места, которые сами клали адрес в сообщение, теперь
 * пишут идентификатор пользователя. Плюс маскирование в самой редакции — как
 * сеть последней надежды: пишущих мест десятки, и полагаться на дисциплину нельзя.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { redactText } from '../utils/logger';

const ROOT = join(__dirname, '..', '..');

describe('AI-41: почта не попадает в лог целиком', () => {
  it('локальная часть скрыта, домен виден', () => {
    expect(redactText('Пользователь ivan.petrov@example.com вошёл')).toBe(
      'Пользователь i***@example.com вошёл',
    );
  });

  it('несколько адресов в одной строке — скрыты все', () => {
    const out = redactText('от alice@a.ru кому bob@b.com');
    expect(out).toBe('от a***@a.ru кому b***@b.com');
  });

  it('адрес в JSON-подобном тексте тоже скрыт', () => {
    const out = redactText('{"email":"user@domain.org","id":7}');
    expect(out).not.toContain('user@domain.org');
    expect(out).toContain('domain.org');
  });

  it('домен остаётся читаемым: по нему дежурный отличает своего от служебного', () => {
    // Личность по домену не восстанавливается, а польза при разборе есть.
    expect(redactText('письмо от info@smmniap.pw')).toContain('@smmniap.pw');
  });

  it('обычный текст с собакой не ломается', () => {
    // Упоминание вида @username адресом не является и трогать его нельзя.
    expect(redactText('спросите @signmark в чате')).toBe('спросите @signmark в чате');
  });

  it('секреты по-прежнему режутся целиком, а не маскируются как почта', () => {
    const out = redactText('Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345');
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain('abcdefghijklmnopqrstuvwxyz012345');
  });
});

describe('AI-41: пишущие места не передают адрес в лог', () => {
  const sources = [
    'server/api/auth-routes.ts',
    'server/routes-global-api-keys.ts',
  ];

  it('в сообщениях о входе и о правах администратора адреса больше нет', () => {
    // Именно эти четыре сообщения дали все 40 строк в замере боевых логов.
    for (const rel of sources) {
      const src = readFileSync(join(ROOT, rel), 'utf-8');
      const logLinesWithEmail = src
        .split('\n')
        .filter((line) => /\blog\(/.test(line) && /\.email\b/.test(line));
      expect(logLinesWithEmail, `${rel}: адрес почты в вызове log()`).toEqual([]);
    }
  });
});
