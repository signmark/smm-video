export const MAX_RESTORED_SESSION_AGE_MS = 24 * 60 * 60 * 1000;

export function shouldRestoreSession(expiresAt: number | null, now: number = Date.now()): boolean {
  // An unparsable token may still have a valid refresh token, so keep it eligible.
  return expiresAt === null || expiresAt >= now - MAX_RESTORED_SESSION_AGE_MS;
}
