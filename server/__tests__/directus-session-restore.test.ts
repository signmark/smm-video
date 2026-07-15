import { describe, expect, it } from 'vitest';
import {
  MAX_RESTORED_SESSION_AGE_MS,
  shouldRestoreSession
} from '../services/directus-session-policy';

describe('Directus session restore policy', () => {
  const now = Date.UTC(2026, 6, 15, 12, 0, 0);

  it('restores active and recently expired sessions', () => {
    expect(shouldRestoreSession(now + 60_000, now)).toBe(true);
    expect(shouldRestoreSession(now - MAX_RESTORED_SESSION_AGE_MS, now)).toBe(true);
  });

  it('skips sessions expired more than one day ago', () => {
    expect(shouldRestoreSession(now - MAX_RESTORED_SESSION_AGE_MS - 1, now)).toBe(false);
  });

  it('keeps unparsable access tokens eligible for refresh-token recovery', () => {
    expect(shouldRestoreSession(null, now)).toBe(true);
  });
});
