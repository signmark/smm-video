/**
 * Unit tests for server/utils/n8n-utils.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));

describe('server/utils/n8n-utils', () => {
  const savedN8nUrl = process.env.N8N_URL;
  const savedN8nApiKey = process.env.N8N_API_KEY;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    delete process.env.N8N_URL;
    delete process.env.N8N_API_KEY;
  });

  afterEach(() => {
    if (savedN8nUrl !== undefined) process.env.N8N_URL = savedN8nUrl;
    if (savedN8nApiKey !== undefined) process.env.N8N_API_KEY = savedN8nApiKey;
  });

  describe('getN8nUrl', () => {
    it('должен возвращать N8N_URL если он задан', async () => {
      process.env.N8N_URL = 'https://n8n.nplanner.ru';
      const { getN8nUrl } = await import('../utils/n8n-utils');

      const url = getN8nUrl();

      expect(url).toBe('https://n8n.nplanner.ru');
    });

    it('должен возвращать N8N_URL из env', async () => {
      process.env.N8N_URL = 'https://custom-n8n.test';
      const { getN8nUrl } = await import('../utils/n8n-utils');

      const url = getN8nUrl();

      expect(url).toBe('https://custom-n8n.test');
    });

    it('должен возвращать default URL при отсутствии N8N_URL', async () => {
      delete process.env.N8N_URL;
      const { getN8nUrl } = await import('../utils/n8n-utils');

      const url = getN8nUrl();

      expect(url).toBe('https://n8n.roboflow.space');
    });

    it('должен кэшировать результат при повторных вызовах', async () => {
      process.env.N8N_URL = 'https://cached.test';
      const { getN8nUrl } = await import('../utils/n8n-utils');

      const url1 = getN8nUrl();
      const url2 = getN8nUrl();

      expect(url1).toBe(url2);
      expect(console.log).toHaveBeenCalledTimes(1);
    });
  });

  describe('triggerN8nWorkflow', () => {
    it('должен успешно вызывать workflow', async () => {
      process.env.N8N_URL = 'https://n8n.nplanner.ru';
      process.env.N8N_API_KEY = 'test-api-key';
      vi.mocked(axios.post).mockResolvedValue({
        data: { id: 'run-123', finished: true },
      });

      const { triggerN8nWorkflow } = await import('../utils/n8n-utils');
      const result = await triggerN8nWorkflow('workflow-id', { key: 'value' });

      expect(axios.post).toHaveBeenCalledWith(
        'https://n8n.nplanner.ru/api/v1/workflows/workflow-id/execute',
        { data: { key: 'value' } },
        {
          headers: {
            'X-N8N-API-KEY': 'test-api-key',
            'Content-Type': 'application/json',
          },
        }
      );
      expect(result).toEqual({ id: 'run-123', finished: true });
    });

    it('должен выбрасывать ошибку при отсутствии N8N_API_KEY', async () => {
      delete process.env.N8N_API_KEY;

      const { triggerN8nWorkflow } = await import('../utils/n8n-utils');

      await expect(triggerN8nWorkflow('id', {})).rejects.toThrow('N8N API ключ не настроен');
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('должен пробрасывать ошибку от axios', async () => {
      process.env.N8N_URL = 'https://n8n.nplanner.ru';
      process.env.N8N_API_KEY = 'key';
      vi.mocked(axios.post).mockRejectedValue(new Error('Network error'));

      const { triggerN8nWorkflow } = await import('../utils/n8n-utils');

      await expect(triggerN8nWorkflow('id', {})).rejects.toThrow('Network error');
    });
  });
});
