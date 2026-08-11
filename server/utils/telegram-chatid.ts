/**
 * SM-24: Normalize Telegram chat ID to canonical form.
 *
 * Supports:
 * - https://t.me/username → @username
 * - t.me/username → @username
 * - @username → @username
 * - username → @username (if passes Telegram username grammar)
 * - -100XXXXXXXXXXX / numeric ID → as-is
 * - invalid / email / garbage → returns null
 *
 * This runs server-side before persistence. Client should mirror for UX.
 */
export function normalizeTelegramChatId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Already a numeric or supergroup ID
  if (/^-?\d{6,15}$/.test(trimmed)) return trimmed;

  // Extract username from t.me / https://t.me links
  const urlMatch = trimmed.match(/^(?:https?:\/\/)?t\.me\/([a-zA-Z]\w{3,31})\/?$/);
  if (urlMatch) return `@${urlMatch[1]}`;

  // Already @username
  if (/^@[a-zA-Z]\w{3,31}$/.test(trimmed)) return trimmed;

  // Bare username (no @, no URL)
  if (/^[a-zA-Z]\w{3,31}$/.test(trimmed)) return `@${trimmed}`;

  // Invalid: email, description, garbage
  return null;
}
