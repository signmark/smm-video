import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetDirectusSessionValidatorForTests,
  validateDirectusSession,
} from '../services/directus-session-validator';

describe('validateDirectusSession', () => {
  const previousUrl = process.env.DIRECTUS_URL;

  beforeEach(() => resetDirectusSessionValidatorForTests());

  afterEach(() => {
    if (previousUrl === undefined) delete process.env.DIRECTUS_URL;
    else process.env.DIRECTUS_URL = previousUrl;
  });

  it('accepts a token that Directus recognizes', async () => {
    process.env.DIRECTUS_URL = 'https://directus.example/';
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    await expect(validateDirectusSession('access-token', fetchImpl as any)).resolves.toBe('valid');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://directus.example/users/me?fields=id',
      expect.objectContaining({
        headers: { Authorization: 'Bearer access-token' },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('treats Directus 401 as an invalid session', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    await expect(validateDirectusSession('access-token', fetchImpl as any)).resolves.toBe('invalid');
  });

  it('does not invalidate a session on an ambiguous 403', async () => {
    const response = new Response('{}', { status: 403 });
    await expect(validateDirectusSession('access-token', vi.fn().mockResolvedValue(response) as any))
      .resolves.toBe('unavailable');
  });

  it('coalesces parallel validation for the same token', async () => {
    let resolveResponse!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => { resolveResponse = resolve; });
    const fetchImpl = vi.fn().mockReturnValue(pending);

    const validations = Array.from({ length: 20 }, () => validateDirectusSession('same-token', fetchImpl as any));
    resolveResponse(new Response('{}', { status: 200 }));

    await expect(Promise.all(validations)).resolves.toEqual(Array(20).fill('valid'));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('aborts a validation request after the timeout', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));

    const result = validateDirectusSession('slow-token', fetchImpl as any);
    await vi.advanceTimersByTimeAsync(3_001);
    await expect(result).resolves.toBe('unavailable');
    vi.useRealTimers();
  });

  it('does not invalidate a session when Directus is temporarily unavailable', async () => {
    const serverError = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    const networkError = vi.fn().mockRejectedValue(new Error('network unavailable'));

    await expect(validateDirectusSession('access-token', serverError as any)).resolves.toBe('unavailable');
    await expect(validateDirectusSession('access-token', networkError as any)).resolves.toBe('unavailable');
  });
});
