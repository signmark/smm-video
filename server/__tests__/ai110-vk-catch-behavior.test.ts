/**
 * AI-110 (task #51): поведенческий тест VK-catch — итоговое сообщение не
 * содержит ни raw JSON, ни [object Object], причина остаётся читаемой.
 *
 * Триггер: axios отклоняет запрос с VK-объектом ошибки без error_msg (только
 * error_code). Раньше это давало JSON.stringify → raw JSON, либо прямой
 * `${responseError}` → [object Object]. Теперь — безопасное представление кода.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAxiosPost = vi.fn();
const mockAxiosGet = vi.fn();

vi.mock('axios', () => ({
  default: {
    post: (...args: any[]) => mockAxiosPost(...args),
    get: (...args: any[]) => mockAxiosGet(...args),
    create: vi.fn(() => ({
      post: (...args: any[]) => mockAxiosPost(...args),
      get: (...args: any[]) => mockAxiosGet(...args),
      interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    })),
  },
}));

describe('AI-110: VK catch — нет [object Object] и raw JSON', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('axios rejecting с VK-объектом error_code (без error_msg) → читаемое сообщение', async () => {
    // getWallUploadServer
    mockAxiosPost.mockResolvedValueOnce({
      data: { response: { upload_url: 'http://upload.vk.com' } },
      status: 200,
    });
    // скачивание картинки
    mockAxiosGet.mockResolvedValueOnce({
      data: Buffer.from('fake-image'),
      headers: { 'content-type': 'image/jpeg' },
    });
    // загрузка на upload-server
    mockAxiosPost.mockResolvedValueOnce({
      data: { photo: 'p', server: 1, hash: 'h' },
    });
    // saveWallPhoto — axios REJECT с объектом ошибки (не resolve-with-error)
    const axiosError: any = new Error('Request failed with status code 400');
    axiosError.response = {
      status: 400,
      data: { error: { error_code: 5 } }, // только код, без error_msg
    };
    mockAxiosPost.mockRejectedValueOnce(axiosError);

    const { vkService } = await import('../services/social-platforms/vk-service');
    const result = await vkService.publishPost(
      { token: 'tok', groupId: '123' },
      { text: 'test', imageUrl: 'http://example.com/img.jpg' },
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    // Ни raw JSON, ни [object Object].
    expect(result.error).not.toContain('{"error');
    expect(result.error).not.toContain('"error_code"');
    expect(result.error).not.toContain('[object Object]');
    // Причина осталась читаемой (есть код ошибки).
    expect(result.error).toContain('code 5');
  });
});
