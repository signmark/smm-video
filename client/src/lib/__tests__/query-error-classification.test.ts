import { describe, expect, it } from 'vitest';
import { classifyQueryError, type QueryErrorClass } from '../query-error-classification';

function errorLike(status?: number, message?: string, extra?: Record<string, unknown>): Error {
  const err: any = new Error(message ?? 'request failed');
  if (status !== undefined) {
    err.status = status;
    err.response = { status, statusText: 'X' };
  }
  if (extra) Object.assign(err, extra);
  return err;
}

describe('classifyQueryError', () => {
  it.each<[number, QueryErrorClass]>([
    [401, 'session-invalid'],
    [403, 'forbidden'],
    [404, 'not-found'],
    [429, 'rate-limited'],
    [500, 'server-error'],
    [502, 'server-error'],
    [503, 'server-error'],
    [504, 'server-error'],
  ])('maps HTTP %i to "%s"', (status, expected) => {
    expect(classifyQueryError(errorLike(status)).kind).toBe(expected);
  });

  it('treats auth-specific markers as session-invalid even without 401', () => {
    const a = classifyQueryError(errorLike(undefined, 'AUTH_FAILED', { authFailed: true }));
    const b = classifyQueryError(errorLike(undefined, 'AUTH_SESSION_CHANGED', { sessionChanged: true }));
    const c = classifyQueryError(errorLike(undefined, 'Token refreshed', { tokenRefreshed: true }));
    expect(a.kind).toBe('session-invalid');
    expect(b.kind).toBe('session-invalid');
    expect(c.kind).toBe('session-refreshed');
  });

  it('treats explicit authUnavailable as session-unavailable', () => {
    const e = classifyQueryError(errorLike(undefined, 'check connection', { authUnavailable: true }));
    expect(e.kind).toBe('session-unavailable');
  });

  it('falls back to network for fetch failure with TypeError (offline)', () => {
    const offline = new TypeError('Failed to fetch');
    expect(classifyQueryError(offline).kind).toBe('network');
  });

  it('returns unknown for anything else', () => {
    expect(classifyQueryError(new Error('something weird')).kind).toBe('unknown');
  });

  it('never leaks server message into user-facing message', () => {
    const classified = classifyQueryError(
      errorLike(500, 'PG connection failed at /var/secret/db: FATAL: pwd=leaked'),
    );
    expect(classified.userMessage).not.toMatch(/pwd|FATAL|\/var\//);
    expect(classified.userMessage.length).toBeGreaterThan(0);
  });

  it('returns a non-empty userMessage for every kind', () => {
    const samples: Array<[number, string]> = [
      [401, ''],
      [403, ''],
      [404, ''],
      [429, ''],
      [500, ''],
      [502, ''],
    ];
    for (const [status] of samples) {
      const c = classifyQueryError(errorLike(status, 'leak me ' + status));
      expect(c.userMessage).toBeTruthy();
    }
  });
});
