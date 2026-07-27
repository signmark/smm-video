import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getVkTokenWebhookStatus,
  prepareVkTokenWebhook,
} from './vk-token-webhook';

describe('VK token-webhook client', () => {
  const fetchMock = vi.fn();
  const getItem = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    getItem.mockReset();
    getItem.mockReturnValue('user-token');
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('localStorage', { getItem });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prepares the stable URL with the current Authorization token', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ webhookUrl: 'https://app/api/vk/token-webhook/camp-1/submit/secret' }),
    });

    await expect(prepareVkTokenWebhook('camp-1')).resolves.toBe(
      'https://app/api/vk/token-webhook/camp-1/submit/secret',
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/vk/token-webhook/camp-1/prepare',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer user-token' },
      },
    );
  });

  it('polls status with the current Authorization token', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ready: true }),
    });

    await expect(getVkTokenWebhookStatus('camp-1')).resolves.toEqual({ ready: true });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/vk/token-webhook/camp-1/status',
      { headers: { Authorization: 'Bearer user-token' } },
    );
  });
});
