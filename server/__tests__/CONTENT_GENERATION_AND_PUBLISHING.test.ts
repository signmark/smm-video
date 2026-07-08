/**
 * Комплексные тесты генерации контента и публикации во все платформы
 *
 * Покрывает:
 * - ThreadsService: sanitizeThreadsText, publishPost (text/image/video), validateToken
 * - AiService: generateContent (Gemini/DeepSeek/Qwen), fallback при неизвестном сервисе
 * - PublishScheduler.publishToThreadsDirect: campaign_id как объект vs строка, ошибки HTTP, отсутствие настроек
 * - PublishScheduler.publishThroughN8nWebhook: VK, Instagram (post vs story), Facebook, Telegram, YouTube
 * - PublishScheduler.publishContentToPlatforms: параллельная публикация в несколько платформ
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Axios нужно мокать ДО всех импортов ────────────────────────────────────
vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
    create: vi.fn().mockReturnValue({
      interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } }
    })
  }
}));

vi.mock('../utils/logger', () => ({
  log: vi.fn(),
  default: { log: vi.fn() }
}));

vi.mock('../services/directus-crud', () => ({
  directusCrud: {
    list: vi.fn(),
    update: vi.fn()
  }
}));

vi.mock('../services/publication-lock-manager', () => ({
  publicationLockManager: {
    isLocked: vi.fn().mockReturnValue(false),
    acquireLock: vi.fn().mockResolvedValue(true),
    releaseLock: vi.fn().mockResolvedValue(true)
  }
}));

vi.mock('../services/publication-tracking', () => ({
  publicationTracker: {
    canPublish: vi.fn().mockResolvedValue(true),
    markAsProcessed: vi.fn().mockResolvedValue(true),
    releasePublication: vi.fn().mockResolvedValue(true)
  }
}));

vi.mock('../index', () => ({
  broadcastNotification: vi.fn()
}));

vi.mock('../services/global-api-keys', () => ({
  globalApiKeysService: {
    getGlobalApiKey: vi.fn()
  },
  ApiServiceName: {}
}));

vi.mock('../services/api-keys', () => ({
  apiKeyService: {
    getApiKey: vi.fn()
  },
  ApiServiceName: {
    GEMINI: 'gemini',
    DEEPSEEK: 'deepseek',
    GOOGLE_API_KEY: 'google_api_key'
  }
}));

vi.mock('../utils/n8n-utils', () => ({
  getN8nUrl: vi.fn().mockReturnValue('https://n8n.example.com')
}));

vi.mock('../services/gemini-proxy', () => ({
  geminiProxyService: {
    setApiKey: vi.fn(),
    generateContent: vi.fn()
  }
}));

vi.mock('../services/gemini-direct', () => ({
  geminiDirect: {
    generateContent: vi.fn()
  }
}));

vi.mock('../directus', () => ({
  directusApi: {}
}));

vi.mock('../services/web-crawler-agent', () => ({
  webCrawlerAgent: {}
}));

vi.mock('../utils/ai-helpers', () => ({
  extractFullSiteContent: vi.fn()
}));

vi.mock('../services/storage', () => ({}));
vi.mock('../storage', () => ({ storage: {} }));
vi.mock('../services/social/index', () => ({ socialPublishingService: {} }));
vi.mock('../services/directus-auth-manager', () => ({
  directusAuthManager: {
    getValidToken: vi.fn().mockResolvedValue('mock-admin-token'),
    shutdown: vi.fn()
  }
}));

// ─── Импорты после моков ─────────────────────────────────────────────────────
import axios from 'axios';
import { threadsService } from '../services/social-platforms/threads-service';
import { AiService } from '../services/ai-service';
import { globalApiKeysService } from '../services/global-api-keys';
import { apiKeyService } from '../services/api-keys';
import { directusCrud } from '../services/directus-crud';
import { getPublishScheduler } from '../services/publish-scheduler';
import { getN8nUrl } from '../utils/n8n-utils';
import { publicationTracker } from '../services/publication-tracking';
import { publicationLockManager } from '../services/publication-lock-manager';

// ─── Глобальный beforeEach: сброс всех моков + восстановление дефолтов ───────
// vi.resetAllMocks() очищает как call-историю, так и очередь mockResolvedValueOnce
beforeEach(() => {
  vi.resetAllMocks();
  // Восстанавливаем дефолты, которые нужны в большинстве тестов
  vi.mocked(directusCrud.update).mockResolvedValue({} as any);
  vi.mocked(getN8nUrl).mockReturnValue('https://n8n.example.com');
  // publicationTracker и publicationLockManager должны разрешать публикацию по умолчанию
  vi.mocked(publicationTracker.canPublish).mockResolvedValue(true);
  vi.mocked(publicationTracker.markAsProcessed).mockResolvedValue(true as any);
  vi.mocked(publicationTracker.releasePublication).mockResolvedValue(true as any);
  vi.mocked(publicationLockManager.acquireLock).mockResolvedValue(true as any);
  vi.mocked(publicationLockManager.isLocked).mockReturnValue(false as any);
  vi.mocked(publicationLockManager.releaseLock).mockResolvedValue(true as any);
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. ThreadsService
// ══════════════════════════════════════════════════════════════════════════════
describe('ThreadsService', () => {
  const validSettings = {
    appId: 'app-1',
    appSecret: 'secret-1',
    accessToken: 'token-abc',
    threadsUserId: 'user-123',
    username: 'testuser'
  };

  // ── validateToken ──────────────────────────────────────────────────────────
  describe('validateToken', () => {
    it('возвращает isValid=false если токен отсутствует', async () => {
      const result = await threadsService.validateToken({});
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Токен');
    });

    it('возвращает isValid=true при успешном ответе API', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: { id: 'user-123', username: 'testuser' }
      });
      const result = await threadsService.validateToken({ accessToken: 'token-abc' });
      expect(result.isValid).toBe(true);
      expect(result.username).toBe('testuser');
    });

    it('возвращает isValid=false при сетевой ошибке', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce(new Error('Network Error'));
      const result = await threadsService.validateToken({ accessToken: 'bad-token' });
      expect(result.isValid).toBe(false);
    });

    it('возвращает pendingReview=true при ошибке threads_basic permission', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce({
        response: {
          data: { error: { message: 'Requires threads_basic permission' } }
        }
      });
      const result = await threadsService.validateToken({
        accessToken: 'token-abc',
        threadsUserId: 'user-123'
      });
      expect(result.isValid).toBe(true);
      expect(result.pendingReview).toBe(true);
    });

    it('возвращает pendingReview=true при ошибке app review', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce({
        response: {
          data: { error: { message: 'This app is pending app review' } }
        }
      });
      const result = await threadsService.validateToken({ accessToken: 'token-abc' });
      expect(result.isValid).toBe(true);
      expect(result.pendingReview).toBe(true);
    });
  });

  // ── publishPost — text ─────────────────────────────────────────────────────
  describe('publishPost — текстовый пост', () => {
    it('успешно публикует текстовый пост', async () => {
      vi.mocked(axios.post)
        .mockResolvedValueOnce({ data: { id: 'container-1' } })
        .mockResolvedValueOnce({ data: { id: 'post-999' } });

      const result = await threadsService.publishPost(validSettings, { text: 'Hello Threads!' });

      expect(result.success).toBe(true);
      expect(result.postId).toBe('post-999');
      expect(result.postUrl).toContain('testuser');
      expect(result.postUrl).toContain('post-999');
    });

    it('возвращает success=false при отсутствии container ID', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ data: {} });
      const result = await threadsService.publishPost(validSettings, { text: 'Test' });
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('возвращает success=false при HTTP ошибке API', async () => {
      vi.mocked(axios.post).mockRejectedValueOnce({
        response: { data: { error: { message: 'Invalid access token' } } }
      });
      const result = await threadsService.publishPost(validSettings, { text: 'Test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid access token');
    });

    it('передаёт media_type=TEXT для текстового поста', async () => {
      vi.mocked(axios.post)
        .mockResolvedValueOnce({ data: { id: 'c-txt' } })
        .mockResolvedValueOnce({ data: { id: 'p-txt' } });

      await threadsService.publishPost(validSettings, { text: 'Text only' });

      const firstCall = vi.mocked(axios.post).mock.calls[0];
      expect((firstCall[2] as any).params.media_type).toBe('TEXT');
    });
  });

  // ── publishPost — image ────────────────────────────────────────────────────
  describe('publishPost — пост с изображением', () => {
    it('отправляет media_type=IMAGE при наличии imageUrl', async () => {
      vi.mocked(axios.post)
        .mockResolvedValueOnce({ data: { id: 'container-img' } })
        .mockResolvedValueOnce({ data: { id: 'post-img' } });

      const result = await threadsService.publishPost(validSettings, {
        text: 'Photo post',
        imageUrl: 'https://cdn.example.com/photo.jpg'
      });

      expect(result.success).toBe(true);
      const firstCall = vi.mocked(axios.post).mock.calls[0];
      const params = (firstCall[2] as any).params;
      expect(params.media_type).toBe('IMAGE');
      expect(params.image_url).toBe('https://cdn.example.com/photo.jpg');
    });
  });

  // ── publishPost — video ────────────────────────────────────────────────────
  // Видео-пост ждёт 5 сек реального таймера — используем fake timers
  describe('publishPost — пост с видео', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('отправляет media_type=VIDEO при наличии videoUrl', async () => {
      // VIDEO flow: axios.get (refreshLongLivedToken) → axios.get (скачать видео) →
      //             axios.post (Cloudinary) → axios.post (контейнер) →
      //             polling → axios.post (publish) → axios.get (permalink)
      const fakeVideo = Buffer.from('fake-video');
      vi.mocked(axios.get)
        .mockResolvedValueOnce({ data: {} })                                                   // refreshLongLivedToken
        .mockResolvedValueOnce({ data: fakeVideo, headers: { 'content-type': 'video/mp4' } }) // скачать
        .mockResolvedValueOnce({ data: { status: 'FINISHED' } })                              // polling
        .mockResolvedValueOnce({ data: {} });                                                  // permalink
      vi.mocked(axios.post)
        .mockResolvedValueOnce({ data: {} })                          // Cloudinary (fail → fallback)
        .mockResolvedValueOnce({ data: { id: 'container-vid' } })    // Threads контейнер
        .mockResolvedValueOnce({ data: { id: 'post-vid' } });        // Threads publish

      const promise = threadsService.publishPost(validSettings, {
        text: 'Video post',
        videoUrl: 'https://cdn.example.com/video.mp4'
      });

      const [result] = await Promise.all([promise, vi.runAllTimersAsync()]);

      expect(result.success).toBe(true);
      // calls[1] = Threads контейнер (calls[0] = Cloudinary upload)
      const containerCall = vi.mocked(axios.post).mock.calls[1];
      const params = (containerCall[2] as any).params;
      expect(params.media_type).toBe('VIDEO');
    });

    it('приоритет VIDEO над IMAGE когда оба переданы', async () => {
      const fakeVideo = Buffer.from('fake');
      vi.mocked(axios.get)
        .mockResolvedValueOnce({ data: {} })                                                   // refreshLongLivedToken
        .mockResolvedValueOnce({ data: fakeVideo, headers: { 'content-type': 'video/mp4' } }) // скачать видео
        .mockResolvedValueOnce({ data: { status: 'FINISHED' } })                              // polling
        .mockResolvedValueOnce({ data: {} });                                                  // permalink
      vi.mocked(axios.post)
        .mockResolvedValueOnce({ data: {} })                       // Cloudinary fail
        .mockResolvedValueOnce({ data: { id: 'c-vid' } })         // контейнер
        .mockResolvedValueOnce({ data: { id: 'p-vid' } });        // publish

      const promise = threadsService.publishPost(validSettings, {
        text: 'Both',
        imageUrl: 'https://img.example.com/img.jpg',
        videoUrl: 'https://vid.example.com/vid.mp4'
      });

      await Promise.all([promise, vi.runAllTimersAsync()]);

      // calls[1] = Threads контейнер, должен быть VIDEO (не IMAGE)
      const containerCall = vi.mocked(axios.post).mock.calls[1];
      expect((containerCall[2] as any).params.media_type).toBe('VIDEO');
    });
  });

  // ── sanitizeThreadsText (тестируем через publishPost) ─────────────────────
  describe('sanitizeThreadsText — очистка текста', () => {
    async function getSentText(rawText: string): Promise<string> {
      vi.mocked(axios.post)
        .mockResolvedValueOnce({ data: { id: 'c1' } })
        .mockResolvedValueOnce({ data: { id: 'p1' } });
      await threadsService.publishPost(validSettings, { text: rawText });
      const firstCall = vi.mocked(axios.post).mock.calls[0];
      return (firstCall[2] as any).params.text;
    }

    it('удаляет HTML-теги', async () => {
      const sent = await getSentText('<p>Hello <b>world</b></p>');
      expect(sent).toBe('Hello world');
    });

    it('декодирует HTML-сущности (&amp; &lt; &gt; &quot; &#39; &nbsp;)', async () => {
      const sent = await getSentText('A &amp; B &lt;3 &gt;5 &quot;quoted&quot; &#39;apos&#39; &nbsp;space');
      expect(sent).toBe("A & B <3 >5 \"quoted\" 'apos' space");
    });

    it('декодирует &mdash; и &ndash;', async () => {
      const sent = await getSentText('before&mdash;after &ndash; dash');
      expect(sent).toBe('before—after – dash');
    });

    it('сжимает множественные пробелы, сохраняет абзацные переносы строк', async () => {
      const sent = await getSentText('word1   word2\n\nword3');
      // функция сжимает повторные пробелы, но сохраняет \n\n как разрыв абзаца
      expect(sent).toBe('word1 word2\n\nword3');
    });

    it('обрезает текст до 500 символов и добавляет ...', async () => {
      const longText = 'A'.repeat(600);
      const sent = await getSentText(longText);
      expect(sent.length).toBe(500);
      expect(sent.endsWith('...')).toBe(true);
    });

    it('не обрезает текст длиной ровно 500 символов', async () => {
      const exactText = 'B'.repeat(500);
      const sent = await getSentText(exactText);
      expect(sent.length).toBe(500);
      expect(sent.endsWith('...')).toBe(false);
    });

    it('пустая строка — publishPost не падает', async () => {
      vi.mocked(axios.post)
        .mockResolvedValueOnce({ data: { id: 'c1' } })
        .mockResolvedValueOnce({ data: { id: 'p1' } });
      const result = await threadsService.publishPost(validSettings, { text: '' });
      expect(result.success).toBe(true);
    });

    it('смешанный HTML + длинный текст: сначала очистка, потом обрезка', async () => {
      const rawHtml = '<p>' + 'X'.repeat(600) + '</p>';
      const sent = await getSentText(rawHtml);
      expect(sent.length).toBe(500);
      expect(sent.startsWith('X')).toBe(true);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. AiService — генерация контента
// ══════════════════════════════════════════════════════════════════════════════
describe('AiService — generateContent', () => {
  let aiService: AiService;

  beforeEach(() => {
    aiService = new AiService();
    vi.mocked(globalApiKeysService.getGlobalApiKey).mockResolvedValue('test-api-key');
    vi.mocked(directusCrud.update).mockResolvedValue({} as any);
  });

  describe('DeepSeek', () => {
    it('успешно генерирует контент через DeepSeek', async () => {
      vi.mocked(apiKeyService.getApiKey).mockResolvedValue(null);
      vi.mocked(globalApiKeysService.getGlobalApiKey).mockResolvedValue('deepseek-key');

      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: 'Сгенерированный пост для VK' } }]
        }
      });

      const result = await aiService.generateWithDeepSeek({
        prompt: 'Напиши пост для VK о новом продукте',
        service: 'deepseek'
      });

      expect(result.success).toBe(true);
      expect(result.content).toBe('Сгенерированный пост для VK');
      expect(result.service).toBe('deepseek');
    });

    it('бросает ошибку если API ключ DeepSeek не найден', async () => {
      vi.mocked(apiKeyService.getApiKey).mockResolvedValue(null);
      vi.mocked(globalApiKeysService.getGlobalApiKey).mockResolvedValue(null);

      await expect(aiService.generateWithDeepSeek({
        prompt: 'test',
        service: 'deepseek'
      })).rejects.toThrow('API ключ DeepSeek не найден');
    });

    it('выбирает deepseek через generateContent по service=deepseek', async () => {
      vi.mocked(apiKeyService.getApiKey).mockResolvedValue(null);
      vi.mocked(globalApiKeysService.getGlobalApiKey).mockResolvedValue('deepseek-key');

      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: 'Deepseek ответ' } }]
        }
      });

      const result = await aiService.generateContent({
        prompt: 'Контент для Telegram',
        service: 'deepseek'
      });

      expect(result.content).toBe('Deepseek ответ');
      expect(vi.mocked(axios.post).mock.calls[0][0]).toContain('deepseek');
    });

    it('DeepSeek передаёт правильный model и temperature', async () => {
      vi.mocked(apiKeyService.getApiKey).mockResolvedValue(null);
      vi.mocked(globalApiKeysService.getGlobalApiKey).mockResolvedValue('deepseek-key');

      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { choices: [{ message: { content: 'ok' } }] }
      });

      await aiService.generateWithDeepSeek({
        prompt: 'test',
        model: 'deepseek-coder',
        temperature: 0.3,
        maxTokens: 500
      });

      const [, body] = vi.mocked(axios.post).mock.calls[0];
      expect((body as any).model).toBe('deepseek-coder');
      expect((body as any).temperature).toBe(0.3);
      expect((body as any).max_tokens).toBe(500);
    });
  });

  describe('generateContent — маршрутизация сервиса', () => {
    it('fallback на Gemini при неизвестном service', async () => {
      vi.spyOn(aiService, 'generateWithGemini').mockResolvedValueOnce({
        success: true,
        content: 'Gemini fallback ответ',
        service: 'gemini'
      });

      const result = await aiService.generateContent({
        prompt: 'test',
        service: 'unknown_service'
      });

      expect(aiService.generateWithGemini).toHaveBeenCalled();
      expect(result.content).toBe('Gemini fallback ответ');
    });

    it('вызывает generateWithGemini для service=gemini', async () => {
      vi.spyOn(aiService, 'generateWithGemini').mockResolvedValueOnce({
        success: true,
        content: 'Gemini ответ',
        service: 'gemini'
      });

      await aiService.generateContent({ prompt: 'test', service: 'gemini' });
      expect(aiService.generateWithGemini).toHaveBeenCalledOnce();
    });

    it('вызывает generateWithGemini для service=apiservice', async () => {
      vi.spyOn(aiService, 'generateWithGemini').mockResolvedValueOnce({
        success: true,
        content: 'Via apiservice',
        service: 'gemini'
      });

      await aiService.generateContent({ prompt: 'test', service: 'apiservice' });
      expect(aiService.generateWithGemini).toHaveBeenCalledOnce();
    });

    it('вызывает generateWithDeepSeek для service=deepseek', async () => {
      vi.spyOn(aiService, 'generateWithDeepSeek').mockResolvedValueOnce({
        success: true,
        content: 'DS ответ',
        service: 'deepseek'
      });

      await aiService.generateContent({ prompt: 'test', service: 'deepseek' });
      expect(aiService.generateWithDeepSeek).toHaveBeenCalledOnce();
    });
  });

  describe('generateContent — типы контента (платформы)', () => {
    it('передаёт platform=instagram в параметры генерации', async () => {
      vi.spyOn(aiService, 'generateWithGemini').mockResolvedValueOnce({
        success: true,
        content: 'Instagram пост',
        service: 'gemini'
      });

      await aiService.generateContent({
        prompt: 'Пост о продукте',
        platform: 'instagram',
        service: 'gemini'
      });

      const call = vi.mocked(aiService.generateWithGemini).mock.calls[0][0];
      expect(call.platform).toBe('instagram');
    });

    it('передаёт keywords в параметры генерации', async () => {
      vi.spyOn(aiService, 'generateWithDeepSeek').mockResolvedValueOnce({
        success: true,
        content: 'Ответ с ключевыми словами',
        service: 'deepseek'
      });

      await aiService.generateContent({
        prompt: 'Сгенерируй пост',
        keywords: ['SMM', 'маркетинг', 'контент'],
        service: 'deepseek'
      });

      const call = vi.mocked(aiService.generateWithDeepSeek).mock.calls[0][0];
      expect(call.keywords).toEqual(['SMM', 'маркетинг', 'контент']);
    });

    it('передаёт tone в параметры генерации', async () => {
      vi.spyOn(aiService, 'generateWithGemini').mockResolvedValueOnce({
        success: true,
        content: 'Формальный ответ',
        service: 'gemini'
      });

      await aiService.generateContent({
        prompt: 'Деловой пост',
        tone: 'formal',
        service: 'gemini'
      });

      const call = vi.mocked(aiService.generateWithGemini).mock.calls[0][0];
      expect(call.tone).toBe('formal');
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. PublishScheduler — publishToThreadsDirect
// ══════════════════════════════════════════════════════════════════════════════
describe('PublishScheduler — publishToThreadsDirect', () => {
  const scheduler = getPublishScheduler();

  const baseContent = {
    id: 'content-uuid-1',
    content: 'Тестовый пост для Threads',
    text_content: null,
    title: null,
    image_url: null,
    video_url: null,
    social_platforms: {}
  };

  beforeEach(() => {
    process.env.DIRECTUS_URL = 'http://directus.test';
    process.env.DIRECTUS_TOKEN = 'admin-token';
  });

  it('успешно публикует когда campaign_id — строка', async () => {
    const content = { ...baseContent, campaign_id: 'camp-uuid-1' };

    vi.mocked(axios.get).mockResolvedValueOnce({
      data: {
        data: {
          social_media_settings: {
            threads: {
              accessToken: 'token-abc',
              threadsUserId: 'user-123',
              username: 'testuser'
            }
          }
        }
      }
    });

    vi.mocked(axios.post)
      .mockResolvedValueOnce({ data: { id: 'container-1' } })
      .mockResolvedValueOnce({ data: { id: 'post-111' } });

    // @ts-ignore
    const result = await scheduler.publishToThreadsDirect(content);

    expect(result.success).toBe(true);
    expect(result.platform).toBe('threads');
    expect(vi.mocked(axios.get).mock.calls[0][0]).toContain('camp-uuid-1');
  });

  it('успешно публикует когда campaign_id — объект {id: "..."}', async () => {
    // Баг: Directus relation возвращает {id: 'camp-uuid-2'} вместо строки
    const content = { ...baseContent, campaign_id: { id: 'camp-uuid-2' } };

    vi.mocked(axios.get).mockResolvedValueOnce({
      data: {
        data: {
          social_media_settings: {
            threads: {
              accessToken: 'token-xyz',
              threadsUserId: 'user-456',
              username: 'user456'
            }
          }
        }
      }
    });

    vi.mocked(axios.post)
      .mockResolvedValueOnce({ data: { id: 'container-2' } })
      .mockResolvedValueOnce({ data: { id: 'post-222' } });

    // @ts-ignore
    const result = await scheduler.publishToThreadsDirect(content);

    expect(result.success).toBe(true);
    const campaignUrl = vi.mocked(axios.get).mock.calls[0][0] as string;
    // Критично: URL должен содержать строку 'camp-uuid-2', а НЕ '[object Object]'
    expect(campaignUrl).toContain('camp-uuid-2');
    expect(campaignUrl).not.toContain('[object Object]');
  });

  it('возвращает success=false и обновляет статус на failed при HTTP 403 кампании', async () => {
    // retryCount=3 исчерпывает MAX_RETRIES (3) → шедулер ставит status: 'failed'
    const content = {
      ...baseContent,
      campaign_id: 'camp-forbidden',
      social_platforms: { threads: { retryCount: 3 } }
    };

    vi.mocked(axios.get).mockRejectedValueOnce(
      Object.assign(new Error('Request failed with status code 403'), {
        response: { status: 403, data: { errors: [{ message: 'Forbidden' }] } }
      })
    );

    // @ts-ignore
    const result = await scheduler.publishToThreadsDirect(content);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    const updateCall = vi.mocked(directusCrud.update).mock.calls[0];
    expect((updateCall[2] as any).social_platforms.threads.status).toBe('failed');
  });

  it('возвращает success=false если Threads не настроен (null)', async () => {
    const content = { ...baseContent, campaign_id: 'camp-no-threads' };

    vi.mocked(axios.get).mockResolvedValueOnce({
      data: {
        data: {
          social_media_settings: { threads: null }
        }
      }
    });

    // @ts-ignore
    const result = await scheduler.publishToThreadsDirect(content);

    expect(result.success).toBe(false);
    expect(result.error).toContain('не настроен');
  });

  it('возвращает success=false если Threads settings без accessToken', async () => {
    const content = { ...baseContent, campaign_id: 'camp-partial' };

    vi.mocked(axios.get).mockResolvedValueOnce({
      data: {
        data: {
          social_media_settings: {
            threads: { threadsUserId: 'u1' }  // нет accessToken
          }
        }
      }
    });

    // @ts-ignore
    const result = await scheduler.publishToThreadsDirect(content);

    expect(result.success).toBe(false);
    expect(result.error).toContain('не настроен');
  });

  it('возвращает success=false если campaign_id не задан', async () => {
    const content = { ...baseContent, campaign_id: null };

    // @ts-ignore
    const result = await scheduler.publishToThreadsDirect(content);

    expect(result.success).toBe(false);
    expect(result.error).toContain('campaign_id');
  });

  it('сохраняет правильные данные в Directus при успешной публикации', async () => {
    const content = {
      ...baseContent,
      campaign_id: 'camp-success',
      social_platforms: { vk: { status: 'published', postUrl: 'https://vk.com/post1' } }
    };

    vi.mocked(axios.get).mockResolvedValueOnce({
      data: {
        data: {
          social_media_settings: {
            threads: { accessToken: 'token', threadsUserId: 'u1', username: 'myuser' }
          }
        }
      }
    });

    vi.mocked(axios.post)
      .mockResolvedValueOnce({ data: { id: 'c-ok' } })
      .mockResolvedValueOnce({ data: { id: 'p-ok' } });

    const mockSave = vi.fn(async (platform: string, data: any) => {
      const merged = { ...content.social_platforms, [platform]: data };
      await directusCrud.update('content', content.id, { social_platforms: merged });
    });

    // @ts-ignore
    await (scheduler as any).publishToThreadsDirect(content, mockSave);

    const updateCall = vi.mocked(directusCrud.update).mock.calls[0];
    const socialPlatforms = (updateCall[2] as any).social_platforms;

    expect(socialPlatforms.vk.status).toBe('published');       // VK нетронут
    expect(socialPlatforms.threads.status).toBe('published');  // Threads добавлен
    expect(socialPlatforms.threads.postId).toBe('p-ok');
    expect(socialPlatforms.threads.postUrl).toContain('myuser');
    expect(socialPlatforms.threads.publishedAt).toBeTruthy();
  });

  it('приоритет цепочки текста: text_content → content → title', async () => {
    const content = {
      ...baseContent,
      text_content: null,
      content: '<p>Контент из поля content</p>',
      title: 'Заголовок',
      campaign_id: 'camp-txt'
    };

    vi.mocked(axios.get).mockResolvedValueOnce({
      data: {
        data: {
          social_media_settings: {
            threads: { accessToken: 'tok', threadsUserId: 'uid', username: 'un' }
          }
        }
      }
    });

    vi.mocked(axios.post)
      .mockResolvedValueOnce({ data: { id: 'c-txt' } })
      .mockResolvedValueOnce({ data: { id: 'p-txt' } });

    // @ts-ignore
    await scheduler.publishToThreadsDirect(content);

    const containerCall = vi.mocked(axios.post).mock.calls[0];
    const sentText = (containerCall[2] as any).params.text;
    // HTML должен быть очищен через sanitizeThreadsText
    expect(sentText).toBe('Контент из поля content');
    expect(sentText).not.toContain('<p>');
  });

  it('использует text_content если он задан (приоритет над content)', async () => {
    const content = {
      ...baseContent,
      text_content: 'Приоритетный text_content',
      content: 'Вторичный content',
      title: 'Заголовок',
      campaign_id: 'camp-txt2'
    };

    vi.mocked(axios.get).mockResolvedValueOnce({
      data: {
        data: {
          social_media_settings: {
            threads: { accessToken: 'tok', threadsUserId: 'uid', username: 'un' }
          }
        }
      }
    });

    vi.mocked(axios.post)
      .mockResolvedValueOnce({ data: { id: 'c-t' } })
      .mockResolvedValueOnce({ data: { id: 'p-t' } });

    // @ts-ignore
    await scheduler.publishToThreadsDirect(content);

    const containerCall = vi.mocked(axios.post).mock.calls[0];
    const sentText = (containerCall[2] as any).params.text;
    expect(sentText).toBe('Приоритетный text_content');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. PublishScheduler — publishThroughN8nWebhook
// ══════════════════════════════════════════════════════════════════════════════
describe('PublishScheduler — publishThroughN8nWebhook', () => {
  const scheduler = getPublishScheduler();

  const baseContent = {
    id: 'content-n8n-1',
    content_type: 'post',
    metadata: null
  };

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    vi.mocked(getN8nUrl).mockReturnValue('https://n8n.example.com');
  });

  const platforms = [
    { platform: 'vk', webhook: 'publish-vk' },
    { platform: 'telegram', webhook: 'publish-telegram' },
    { platform: 'facebook', webhook: 'publish-facebook' },
    { platform: 'instagram', webhook: 'publish-instagram' },
  ];

  platforms.forEach(({ platform, webhook }) => {
    it(`отправляет POST на webhook ${webhook} для платформы ${platform}`, async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({ status: 200, data: {} });

      // @ts-ignore
      const result = await scheduler.publishThroughN8nWebhook(baseContent, platform);

      expect(result.success).toBe(true);
      expect(result.platform).toBe(platform);

      const [url, body] = vi.mocked(axios.post).mock.calls[0];
      expect(url as string).toContain(webhook);
      expect((body as any).contentId).toBe('content-n8n-1');
    });
  });

  it('Instagram Story с content_type=story → webhook publish-stories', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({ status: 200, data: {} });

    // @ts-ignore
    await scheduler.publishThroughN8nWebhook({ ...baseContent, content_type: 'story' }, 'instagram');

    const [url] = vi.mocked(axios.post).mock.calls[0];
    expect(url as string).toContain('publish-stories');
  });

  it('Instagram Story через metadata.storyType → webhook publish-stories', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({ status: 200, data: {} });

    // @ts-ignore
    await scheduler.publishThroughN8nWebhook(
      { ...baseContent, content_type: 'post', metadata: { storyType: 'image' } },
      'instagram'
    );

    const [url] = vi.mocked(axios.post).mock.calls[0];
    expect(url as string).toContain('publish-stories');
  });

  it('URL формируется корректно для N8N без /webhook в base URL', async () => {
    vi.mocked(getN8nUrl).mockReturnValue('https://custom-n8n.example.com');
    vi.mocked(axios.post).mockResolvedValueOnce({ status: 200, data: {} });

    // @ts-ignore
    await scheduler.publishThroughN8nWebhook(baseContent, 'vk');

    const [url] = vi.mocked(axios.post).mock.calls[0];
    expect(url as string).toBe('https://custom-n8n.example.com/webhook/publish-vk');
  });

  it('URL формируется корректно когда N8N base уже содержит /webhook', async () => {
    vi.mocked(getN8nUrl).mockReturnValue('https://n8n.example.com/webhook');
    vi.mocked(axios.post).mockResolvedValueOnce({ status: 200, data: {} });

    // @ts-ignore
    await scheduler.publishThroughN8nWebhook(baseContent, 'telegram');

    const [url] = vi.mocked(axios.post).mock.calls[0];
    expect(url as string).toBe('https://n8n.example.com/webhook/publish-telegram');
  });

  it('бросает ошибку при HTTP 500 от N8N', async () => {
    vi.mocked(axios.post).mockRejectedValueOnce(
      Object.assign(new Error('Internal Server Error'), {
        response: { status: 500, data: {} }
      })
    );

    // @ts-ignore
    await expect(scheduler.publishThroughN8nWebhook(baseContent, 'vk'))
      .rejects.toThrow('Internal Server Error');
  });

  it('передаёт timeout 30000ms в запрос к N8N', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({ status: 200, data: {} });

    // @ts-ignore
    await scheduler.publishThroughN8nWebhook(baseContent, 'vk');

    const [, , config] = vi.mocked(axios.post).mock.calls[0];
    expect((config as any).timeout).toBe(30000);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. PublishScheduler — publishContentToPlatforms (параллельная публикация)
// Метод возвращает void — тестируем через spy на внутренние методы
// ══════════════════════════════════════════════════════════════════════════════
describe('PublishScheduler — publishContentToPlatforms', () => {
  const scheduler = getPublishScheduler();

  const baseContent = {
    id: 'content-parallel',
    content: 'Параллельная публикация',
    text_content: null,
    title: null,
    image_url: null,
    video_url: null,
    content_type: 'post',
    metadata: null,
    social_platforms: {},
    campaign_id: 'camp-parallel'
  };

  beforeEach(() => {
    process.env.DIRECTUS_URL = 'http://directus.test';
    process.env.DIRECTUS_TOKEN = 'admin-token';
    process.env.NODE_ENV = 'development';
    vi.mocked(getN8nUrl).mockReturnValue('https://n8n.example.com');
  });

  it('Threads вызывается через publishToThreadsDirect, VK — через publishToVkDirect', async () => {
    // @ts-ignore
    const spyThreads = vi.spyOn(scheduler, 'publishToThreadsDirect')
      .mockResolvedValue({ platform: 'threads', success: true });
    // @ts-ignore
    const spyVk = vi.spyOn(scheduler, 'publishToVkDirect')
      .mockResolvedValue({ platform: 'vk', success: true });
    // @ts-ignore
    vi.spyOn(scheduler, 'updateContentStatus').mockResolvedValue(undefined);

    // @ts-ignore
    await scheduler.publishContentToPlatforms(baseContent, ['threads', 'vk']);

    expect(spyThreads).toHaveBeenCalledWith(baseContent, expect.any(Function));
    expect(spyVk).toHaveBeenCalledWith(baseContent, expect.any(Function));
  });

  it('Threads падает — другие платформы всё равно вызываются', async () => {
    // @ts-ignore
    vi.spyOn(scheduler, 'publishToThreadsDirect')
      .mockRejectedValue(new Error('Threads failed'));
    // @ts-ignore
    const spyVk = vi.spyOn(scheduler, 'publishToVkDirect')
      .mockResolvedValue({ platform: 'vk', success: true });
    // @ts-ignore
    vi.spyOn(scheduler, 'updateContentStatus').mockResolvedValue(undefined);

    // @ts-ignore — не должно бросать исключение
    await expect(
      scheduler.publishContentToPlatforms(baseContent, ['threads', 'vk'])
    ).resolves.not.toThrow();

    expect(spyVk).toHaveBeenCalledWith(baseContent, expect.any(Function));
  });

  it('все платформы (VK, Telegram, Facebook) вызываются напрямую параллельно', async () => {
    // @ts-ignore
    const spyVk = vi.spyOn(scheduler, 'publishToVkDirect')
      .mockResolvedValue({ platform: 'vk', success: true });
    // @ts-ignore
    const spyTelegram = vi.spyOn(scheduler, 'publishToTelegramDirect')
      .mockResolvedValue({ platform: 'telegram', success: true });
    // @ts-ignore
    const spyFacebook = vi.spyOn(scheduler, 'publishToFacebookDirect')
      .mockResolvedValue({ platform: 'facebook', success: true });
    // @ts-ignore
    vi.spyOn(scheduler, 'updateContentStatus').mockResolvedValue(undefined);

    // @ts-ignore
    await scheduler.publishContentToPlatforms(baseContent, ['vk', 'telegram', 'facebook']);

    expect(spyVk).toHaveBeenCalledWith(baseContent, expect.any(Function));
    expect(spyTelegram).toHaveBeenCalledWith(baseContent, expect.any(Function));
    expect(spyFacebook).toHaveBeenCalledWith(baseContent, expect.any(Function));
  });

  it('после публикации вызывается updateContentStatus', async () => {
    // @ts-ignore
    vi.spyOn(scheduler, 'publishThroughN8nWebhook')
      .mockResolvedValue({ platform: 'vk', success: true });
    // @ts-ignore
    const spyUpdate = vi.spyOn(scheduler, 'updateContentStatus').mockResolvedValue(undefined);

    // @ts-ignore
    await scheduler.publishContentToPlatforms(baseContent, ['vk']);

    expect(spyUpdate).toHaveBeenCalledWith(baseContent.id);
  });

  it('блокировки освобождаются после публикации каждой платформы', async () => {
    const { publicationLockManager } = await import('../services/publication-lock-manager');

    // @ts-ignore
    vi.spyOn(scheduler, 'publishToThreadsDirect')
      .mockResolvedValue({ platform: 'threads', success: true });
    // @ts-ignore
    vi.spyOn(scheduler, 'publishThroughN8nWebhook')
      .mockResolvedValue({ platform: 'vk', success: true });
    // @ts-ignore
    vi.spyOn(scheduler, 'updateContentStatus').mockResolvedValue(undefined);

    // @ts-ignore
    await scheduler.publishContentToPlatforms(baseContent, ['threads', 'vk']);

    expect(publicationLockManager.releaseLock).toHaveBeenCalledWith(baseContent.id, 'threads');
    expect(publicationLockManager.releaseLock).toHaveBeenCalledWith(baseContent.id, 'vk');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. Threads — getLongLivedToken
// ══════════════════════════════════════════════════════════════════════════════
describe('ThreadsService — getLongLivedToken', () => {
  it('возвращает долгосрочный токен при успешном ответе API', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: { access_token: 'long-lived-token-xyz' }
    });

    const token = await threadsService.getLongLivedToken('short-token', 'app-id', 'app-secret');
    expect(token).toBe('long-lived-token-xyz');
  });

  it('возвращает краткосрочный токен как fallback при ошибке обмена', async () => {
    vi.mocked(axios.get).mockRejectedValueOnce(new Error('Token exchange failed'));

    const token = await threadsService.getLongLivedToken('short-token-fallback', 'app-id', 'app-secret');
    expect(token).toBe('short-token-fallback');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. Threads — exchangeCodeForToken
// ══════════════════════════════════════════════════════════════════════════════
describe('ThreadsService — exchangeCodeForToken', () => {
  it('успешно обменивает code на токен', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: { access_token: 'exchange-token-abc', user_id: 42 }
    });

    const result = await threadsService.exchangeCodeForToken(
      'auth-code-123',
      'app-id',
      'app-secret',
      'https://app.example.com/callback'
    );

    expect(result.access_token).toBe('exchange-token-abc');
    expect(result.user_id).toBe('42');

    const [, body] = vi.mocked(axios.post).mock.calls[0];
    expect(body.toString()).toContain('authorization_code');
    expect(body.toString()).toContain('auth-code-123');
  });

  it('выбрасывает ошибку при неверном коде (HTTP 400)', async () => {
    vi.mocked(axios.post).mockRejectedValueOnce(
      Object.assign(new Error('Bad Request'), {
        response: { status: 400, data: { error: 'Invalid code' } }
      })
    );

    await expect(
      threadsService.exchangeCodeForToken('bad-code', 'app-id', 'secret', 'https://cb.example.com')
    ).rejects.toThrow('Bad Request');
  });

  it('передаёт Content-Type application/x-www-form-urlencoded', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: { access_token: 'tok', user_id: 1 }
    });

    await threadsService.exchangeCodeForToken('code', 'app', 'sec', 'https://redirect.example.com');

    const [, , config] = vi.mocked(axios.post).mock.calls[0];
    expect((config as any).headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  });
});
