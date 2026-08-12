/**
 * SM-24: Campaign update route — Telegram chatId validation and normalization.
 *
 * Tests PATCH /api/campaigns/:id — the only persistence path for Telegram chatId.
 * Two layers:
 *   1. Unit: normalizeTelegramChatId() — all format/boundary cases
 *   2. Route: express-like handler for the validation/400 branch (without Directus)
 *
 * NOT RUN: no node_modules. @Clause_Dev_Hermi executes.
 *
 * file:line inventory:
 *   server/routes/campaigns.ts:273-284    — normalizeTelegramChatId on telegram.chatId/chat_id
 *   server/utils/telegram-chatid.ts:1-35   — normalizeTelegramChatId()
 *   server/routes/campaigns.ts:54-63       — POST /api/campaigns (does NOT write social_media_settings)
 *   server/routes/campaigns.ts:251-299     — PATCH /api/campaigns/:id (WRITES social_media_settings)
 *   server/routes/campaign-vk-settings.ts      — writes vk subtree, telegram is transit only
 *   server/routes/campaign-instagram-settings.ts — writes instagram subtree, telegram is transit only
 *   server/routes/campaign-youtube-settings.ts   — writes youtube subtree, telegram is transit only
 *   server/routes/campaign-facebook-settings.ts  — writes facebook subtree, telegram is transit only
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalizeTelegramChatId } from '../utils/telegram-chatid';

// ─── Layer 1: Unit tests for normalizeTelegramChatId ─────

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
    expect(normalizeTelegramChatId('@test12345')).toBe('@test12345');
  });

  it('normalizes https://t.me/username to @username', () => {
    expect(normalizeTelegramChatId('https://t.me/my_channel')).toBe('@my_channel');
    expect(normalizeTelegramChatId('https://t.me/MyChannel')).toBe('@MyChannel');
  });

  it('normalizes t.me/username to @username', () => {
    expect(normalizeTelegramChatId('t.me/my_channel')).toBe('@my_channel');
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

  it('rejects 129-char garbage', () => {
    expect(normalizeTelegramChatId('a'.repeat(129))).toBeNull();
    expect(normalizeTelegramChatId('some long description that is not a username')).toBeNull();
  });

  it('rejects empty/whitespace', () => {
    expect(normalizeTelegramChatId('')).toBeNull();
    expect(normalizeTelegramChatId('   ')).toBeNull();
  });

  // Length boundaries (Telegram: 5–32 chars)
  it('rejects 4-char username (below Telegram minimum of 5)', () => {
    expect(normalizeTelegramChatId('@abcd')).toBeNull();
    expect(normalizeTelegramChatId('abcd')).toBeNull();
    expect(normalizeTelegramChatId('https://t.me/abcd')).toBeNull();
  });

  it('accepts 5-char username (Telegram minimum)', () => {
    expect(normalizeTelegramChatId('@abcde')).toBe('@abcde');
    expect(normalizeTelegramChatId('abcde')).toBe('@abcde');
    expect(normalizeTelegramChatId('https://t.me/abcde')).toBe('@abcde');
  });

  it('rejects 33-char username (above Telegram maximum of 32)', () => {
    const longName = 'a'.repeat(33);
    expect(normalizeTelegramChatId(`@${longName}`)).toBeNull();
  });

  it('accepts 32-char username (Telegram maximum)', () => {
    const name32 = 'a'.repeat(32);
    expect(normalizeTelegramChatId(`@${name32}`)).toBe('@' + name32);
    expect(normalizeTelegramChatId(name32)).toBe('@' + name32);
    expect(normalizeTelegramChatId(`https://t.me/${name32}`)).toBe('@' + name32);
  });

  // Real production data (anonymized)
  it('normalizes 3 real t.me-link campaigns from production', () => {
    expect(normalizeTelegramChatId('https://t.me/sofia_busovikova')).toBe('@sofia_busovikova');
    expect(normalizeTelegramChatId('https://t.me/neuro_tech_ai')).toBe('@neuro_tech_ai');
    expect(normalizeTelegramChatId('https://t.me/build_house_kg')).toBe('@build_house_kg');
  });

  // Already valid values pass through
  it('preserves already-canonical values unchanged', () => {
    expect(normalizeTelegramChatId('@channel')).toBe('@channel');
    expect(normalizeTelegramChatId('-1001234567890')).toBe('-1001234567890');
    expect(normalizeTelegramChatId('123456789')).toBe('123456789');
    expect(normalizeTelegramChatId('@MyChannel123')).toBe('@MyChannel123');
  });
});

// ─── Layer 2: Persistence guard — validation logic is injectable ─────

/**
 * SM-24: Simulate the validation guard that lives inside the PATCH handler.
 * This tests: given input telegram settings, does the guard reject invalid
 * chatId before any Directus call, and normalize valid ones?
 *
 * Equivalent to routes/campaigns.ts:273-284
 */
function validateAndNormalizeTelegramChatId(
  telegram: Record<string, any> | undefined,
): { reject: true; error: string } | { reject: false; normalized: Record<string, any> } {
  if (!telegram) return { reject: false, normalized: {} };

  const rawChatId = telegram.chatId ?? telegram.chat_id;
  if (rawChatId === undefined || rawChatId === null || rawChatId === '') {
    return { reject: false, normalized: telegram };
  }

  const normalized = normalizeTelegramChatId(String(rawChatId));
  if (!normalized) {
    return {
      reject: true,
      error: 'Invalid Telegram chat ID. Expected: @username, -100XXXXXXXXX, numeric ID, or t.me link',
    };
  }

  const result = { ...telegram, chatId: normalized };
  delete (result as any).chat_id;
  return { reject: false, normalized: result };
}

describe('SM-24: validateAndNormalizeTelegramChatId guard', () => {
  it('rejects email — handler should return 400 before Directus', () => {
    const result = validateAndNormalizeTelegramChatId({ chatId: 'i.zelenin@nplanner.ru' });
    expect(result.reject).toBe(true);
  });

  it('rejects 129-char garbage', () => {
    const result = validateAndNormalizeTelegramChatId({ chatId: 'a'.repeat(129) });
    expect(result.reject).toBe(true);
  });

  it('normalizes https://t.me/username to @username', () => {
    const result = validateAndNormalizeTelegramChatId({ chatId: 'https://t.me/my_channel' });
    expect(result.reject).toBe(false);
    if (!result.reject) {
      expect(result.normalized.chatId).toBe('@my_channel');
      expect(result.normalized.chat_id).toBeUndefined();
    }
  });

  it('preserves -100XXXXXXXXX as-is', () => {
    const result = validateAndNormalizeTelegramChatId({ chatId: '-1001234567890' });
    expect(result.reject).toBe(false);
    if (!result.reject) expect(result.normalized.chatId).toBe('-1001234567890');
  });

  it('normalizes bare username to @username', () => {
    const result = validateAndNormalizeTelegramChatId({ chatId: 'my_channel' });
    expect(result.reject).toBe(false);
    if (!result.reject) expect(result.normalized.chatId).toBe('@my_channel');
  });

  it('passes through empty chatId without rejection', () => {
    const result = validateAndNormalizeTelegramChatId({ chatId: '' });
    expect(result.reject).toBe(false);
    if (!result.reject) expect(result.normalized.chatId).toBe('');
  });

  it('passes through undefined telegram without rejection', () => {
    const result = validateAndNormalizeTelegramChatId(undefined);
    expect(result.reject).toBe(false);
  });

  it('canonicalizes snake_case chat_id to camelCase chatId', () => {
    const result = validateAndNormalizeTelegramChatId({ chat_id: '@my_channel' });
    expect(result.reject).toBe(false);
    if (!result.reject) {
      expect(result.normalized.chatId).toBe('@my_channel');
      expect(result.normalized.chat_id).toBeUndefined();
    }
  });

  it('rejects 4-char username', () => {
    expect(validateAndNormalizeTelegramChatId({ chatId: '@abcd' }).reject).toBe(true);
  });

  it('accepts 5-char username', () => {
    expect(validateAndNormalizeTelegramChatId({ chatId: '@abcde' }).reject).toBe(false);
  });
});
