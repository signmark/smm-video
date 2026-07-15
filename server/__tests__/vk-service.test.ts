import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn()
  }
}));
vi.mock('form-data', () => ({
  default: class FormData {
    private fields: Record<string, any> = {};
    append(key: string, val: any) { this.fields[key] = val; }
    getHeaders() { return { 'content-type': 'multipart/form-data' }; }
  }
}));
vi.mock('../utils/logger');

import { vkService } from '../services/social-platforms/vk-service';
import axios from 'axios';

const mockSettings = {
  token: 'vk1.a.test_token',
  groupId: '123456'
};

const mockSettingsWithMinus = {
  token: 'vk1.a.test_token',
  groupId: '-123456'
};

describe('VkService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Валидация настроек ──────────────────────────────────────────────────────

  describe('publishPost — отсутствие настроек', () => {
    it('возвращает ошибку если token пустой', async () => {
      const result = await vkService.publishPost(
        { token: '', groupId: '123' },
        { text: 'Test' }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('token');
    });

    it('пытается авто-определить группу если groupId не задан и публикует', async () => {
      // groups.get возвращает список групп
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: { response: { items: [{ id: 999999, name: 'Test Group' }] } }
      });
      // wall.post успешно
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { response: { post_id: 101 } }
      });

      const result = await vkService.publishPost(
        { token: 'vk1.a.xxx', groupId: '' },
        { text: 'Test' }
      );
      expect(result.success).toBe(true);
      expect(result.postUrl).toContain('-999999_101');
    });
  });

  // ─── Текстовый пост ──────────────────────────────────────────────────────────

  describe('publishPost — текстовый контент', () => {
    it('публикует текстовый пост и возвращает postUrl', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { response: { post_id: 777 } }
      });

      const result = await vkService.publishPost(mockSettings, { text: 'Привет ВКонтакте!' });

      expect(result.success).toBe(true);
      expect(result.postId).toBe(777);
      expect(result.postUrl).toBe('https://vk.com/wall-123456_777');
    });

    it('использует правильный owner_id (знак минус перед groupId)', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { response: { post_id: 1 } }
      });

      await vkService.publishPost(mockSettings, { text: 'Test' });

      const body = vi.mocked(axios.post).mock.calls[0][1] as URLSearchParams;
      expect(body.get('owner_id')).toBe('-123456');
      expect(body.get('from_group')).toBe('1');
    });

    it('НЕ дублирует минус если groupId уже начинается с "-"', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { response: { post_id: 2 } }
      });

      await vkService.publishPost(mockSettingsWithMinus, { text: 'Test' });

      const body = vi.mocked(axios.post).mock.calls[0][1] as URLSearchParams;
      expect(body.get('owner_id')).toBe('-123456');
      expect(body.get('owner_id')).not.toContain('--');
    });

    it('конвертирует HTML-список в bullet-points', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { response: { post_id: 3 } }
      });

      await vkService.publishPost(mockSettings, {
        text: '<ul><li>Пункт 1</li><li>Пункт 2</li></ul>'
      });

      const body = vi.mocked(axios.post).mock.calls[0][1] as URLSearchParams;
      expect(body.get('message')).toContain('• Пункт 1');
      expect(body.get('message')).toContain('• Пункт 2');
      expect(body.get('message')).not.toContain('<ul>');
      expect(body.get('message')).not.toContain('<li>');
    });

    it('декодирует HTML-сущности (&amp;, &mdash;)', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { response: { post_id: 4 } }
      });

      await vkService.publishPost(mockSettings, {
        text: 'Текст &amp; ещё &mdash; конец'
      });

      const body = vi.mocked(axios.post).mock.calls[0][1] as URLSearchParams;
      expect(body.get('message')).toContain('&');
      expect(body.get('message')).toContain('—');
      expect(body.get('message')).not.toContain('&amp;');
    });

    it('удаляет все HTML-теги (VK не поддерживает разметку)', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { response: { post_id: 5 } }
      });

      await vkService.publishPost(mockSettings, {
        text: '<p><b>Жирный</b> и <i>курсив</i></p>'
      });

      const body = vi.mocked(axios.post).mock.calls[0][1] as URLSearchParams;
      expect(body.get('message')).not.toMatch(/<[^>]+>/);
      expect(body.get('message')).toContain('Жирный');
      expect(body.get('message')).toContain('курсив');
    });
  });

  // ─── Пост с изображением ─────────────────────────────────────────────────────

  describe('publishPost — контент с изображением', () => {
    const setupPhotoUploadMocks = (postId = 100) => {
      vi.mocked(axios.get)
        .mockResolvedValueOnce({
          data: Buffer.from('img'),
          headers: { 'content-type': 'image/jpeg' }
        });
      vi.mocked(axios.post)
        .mockResolvedValueOnce({ data: { response: { upload_url: 'https://vk.com/upload' } } })
        .mockResolvedValueOnce({ data: { photo: 'xxx', server: 1, hash: 'yyy' } })
        .mockResolvedValueOnce({ data: { response: [{ id: 99, owner_id: -123456 }] } })
        .mockResolvedValueOnce({ data: { response: { post_id: postId } } });
    };

    it('загружает фото и прикрепляет к посту', async () => {
      setupPhotoUploadMocks(200);

      const result = await vkService.publishPost(mockSettings, {
        text: 'Пост с картинкой',
        imageUrl: 'https://example.com/photo.jpg'
      });

      expect(result.success).toBe(true);
      expect(result.postId).toBe(200);

      const wallPostCall = vi.mocked(axios.post).mock.calls.find(c =>
        String(c[0]).includes('wall.post')
      );
      expect(wallPostCall).toBeDefined();
      expect((wallPostCall?.[1] as URLSearchParams).get('attachments')).toBe('photo-123456_99');
    });

    it('не публикует текстовый пост если загрузка обязательного изображения провалилась', async () => {
      vi.mocked(axios.post)
        .mockResolvedValueOnce({ data: {} }); // photos.getWallUploadServer → no upload_url

      const result = await vkService.publishPost(mockSettings, {
        text: 'Пост без фото',
        imageUrl: 'https://example.com/broken.jpg'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('изображение');
      expect(vi.mocked(axios.post).mock.calls.some(call => String(call[0]).includes('wall.post'))).toBe(false);
    });
  });

  // ─── Ошибки VK API ───────────────────────────────────────────────────────────

  describe('publishPost — ошибки VK API', () => {
    it('возвращает ошибку при error в теле ответа (error_code в response.data)', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          error: { error_code: 8, error_msg: 'Invalid request: Application is blocked' }
        }
      });

      const result = await vkService.publishPost(mockSettings, { text: 'Test' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Application is blocked');
    });

    it('возвращает ошибку если post_id отсутствует в ответе', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { response: {} }
      });

      const result = await vkService.publishPost(mockSettings, { text: 'Test' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('post_id');
    });

    it('возвращает ошибку при сетевом сбое', async () => {
      vi.mocked(axios.post).mockRejectedValueOnce(new Error('Network timeout'));

      const result = await vkService.publishPost(mockSettings, { text: 'Test' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network timeout');
    });
  });
});
