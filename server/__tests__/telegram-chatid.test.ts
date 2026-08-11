/**
 * SM-24: Telegram chatId normalization tests.
 *
 * NOT RUN: no node_modules. @Clause_Dev_Hermi executes.
 */
import { describe, it, expect } from 'vitest';
import { normalizeTelegramChatId } from '../utils/telegram-chatid';

describe('normalizeTelegramChatId', () => {
  it('accepts -100XXXXXXXXX supergroup IDs', () => {
    expect(normalizeTelegramChatId('-1001234567890')).toBe('-1001234567890');
    expect(normalizeTelegramChatId('-1009876543')).toBe('-1009876543');
  });

  it('accepts numeric chat IDs', () => {
    expect(normalizeTelegramChatId('123456789')).toBe('123456789');
    expect(normalizeTelegramChatId('987654321')).toBe('987654321');
  });

  it('accepts @username', () => {
    expect(normalizeTelegramChatId('@channel_name')).toBe('@channel_name');
    expect(normalizeTelegramChatId('@MyChannel')).toBe('@MyChannel');
    expect(normalizeTelegramChatId('@test123')).toBe('@test123');
  });

  it('normalizes https://t.me/username to @username', () => {
    expect(normalizeTelegramChatId('https://t.me/channel_name')).toBe('@channel_name');
    expect(normalizeTelegramChatId('https://t.me/MyChannel')).toBe('@MyChannel');
  });

  it('normalizes t.me/username to @username', () => {
    expect(normalizeTelegramChatId('t.me/channel_name')).toBe('@channel_name');
    expect(normalizeTelegramChatId('t.me/MyChannel')).toBe('@MyChannel');
  });

  it('normalizes bare username to @username', () => {
    expect(normalizeTelegramChatId('channel_name')).toBe('@channel_name');
    expect(normalizeTelegramChatId('MyChannel')).toBe('@MyChannel');
  });

  it('rejects email addresses', () => {
    expect(normalizeTelegramChatId('user@example.com')).toBeNull();
    expect(normalizeTelegramChatId('i.zelenin@nplanner.ru')).toBeNull();
  });

  it('rejects garbage / descriptions', () => {
    expect(normalizeTelegramChatId('some long description that is not a username')).toBeNull();
    expect(normalizeTelegramChatId('')).toBeNull();
    expect(normalizeTelegramChatId('   ')).toBeNull();
  });

  it('preserves 32 valid existing values unchanged', () => {
    const valid = [
      '-1001234567890', '@channel', '@MyChannel123', '@test_test',
      '123456789', '-1009876543210',
    ];
    for (const v of valid) {
      const result = normalizeTelegramChatId(v);
      expect(result).not.toBeNull();
      // Already-canonical values should not change
      if (v.startsWith('@') || v.startsWith('-') || /^\d+$/.test(v)) {
        expect(result).toBe(v);
      }
    }
  });

  it('normalizes 3 real t.me-link campaigns from production', () => {
    // Real data from prod (names anonymized)
    expect(normalizeTelegramChatId('https://t.me/sofia_busovikova')).toBe('@sofia_busovikova');
    expect(normalizeTelegramChatId('https://t.me/neuro_tech')).toBe('@neuro_tech');
    expect(normalizeTelegramChatId('https://t.me/build_house')).toBe('@build_house');
  });
});
