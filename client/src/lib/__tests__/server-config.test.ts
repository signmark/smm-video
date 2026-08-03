import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getServerConfig,
  refreshServerConfig,
  resetServerConfigForTests,
  type ServerConfig,
} from '../server-config';

const config = (directusUrl: string): ServerConfig => ({
  directusUrl,
  environment: 'production',
  logLevel: 'error',
  debugScheduler: false,
  verboseLogs: false,
});

const response = (body: ServerConfig, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

describe('server config single-flight', () => {
  beforeEach(() => {
    resetServerConfigForTests();
    vi.unstubAllGlobals();
  });

  it('shares one request between concurrent callers', async () => {
    let resolveFetch!: (value: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    vi.stubGlobal('fetch', fetchMock);

    const first = getServerConfig();
    const second = getServerConfig();
    expect(first).toBe(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(response(config('https://directus.example')));
    await expect(Promise.all([first, second])).resolves.toEqual([
      config('https://directus.example'),
      config('https://directus.example'),
    ]);
  });

  it('clears a failed request so the next caller can retry', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(config('https://unused.example'), 503))
      .mockResolvedValueOnce(response(config('https://directus.example')));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getServerConfig()).rejects.toThrow('Failed to load server config: 503');
    await expect(getServerConfig()).resolves.toEqual(config('https://directus.example'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('performs a new request when a caller forces refresh', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(config('https://first.example')))
      .mockResolvedValueOnce(response(config('https://second.example')));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getServerConfig()).resolves.toEqual(config('https://first.example'));
    await expect(refreshServerConfig()).resolves.toEqual(config('https://second.example'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
