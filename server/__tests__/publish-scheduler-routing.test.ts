/**
 * Тесты публикации контента в разные соцсети через PublishScheduler
 *
 * Покрываем:
 *  1. Роутинг publishContentToPlatforms → правильный приватный метод для каждой платформы
 *  2. VK content_type routing: post → VkDirect, story → VkStories, clip → VkClips
 *  3. Instagram routing: обычный → InstagramDirect, clip+video_url → InstagramReels
 *  4. publishToTelegramDirect: текст / текст+фото / текст+видео / нет настроек
 *  5. publishToVkDirect: текст / текст+фото / ошибка VK API
 *  6. publishToInstagramDirect: фото / нет настроек
 *  7. publishToFacebookDirect: текст+фото / нет настроек
 *  8. publishToThreadsDirect: текст / текст+фото / текст+видео / нет настроек
 *  9. publishToVkStoriesDirect: успех / ошибка API
 * 10. publishToVkClipsDirect: успех / нет video_url
 * 11. publishToInstagramReelsDirect: успех / нет video_url
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Моки статических зависимостей (должны быть до import-ов) ────────────────

vi.mock('axios', () => {
  const instance = Object.assign(vi.fn().mockResolvedValue({ data: {} }), {
    get: vi.fn().mockResolvedValue({ data: { data: {} } }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    interceptors: {
      request: { use: vi.fn(), eject: vi.fn() },
      response: { use: vi.fn(), eject: vi.fn() },
    },
  });
  return {
    default: Object.assign(vi.fn().mockResolvedValue({ data: { data: {} } }), {
      create: vi.fn().mockReturnValue(instance),
      get: vi.fn().mockResolvedValue({ data: { data: {} } }),
      post: vi.fn().mockResolvedValue({ data: {} }),
    }),
  };
});

vi.mock('../utils/logger', () => ({ log: vi.fn() }));
vi.mock('../storage', () => ({ storage: {} }));
vi.mock('../utils/n8n-utils', () => ({
  getN8nUrl: vi.fn().mockReturnValue('http://n8n.test'),
}));
vi.mock('../services/ai-service', () => ({
  aiService: { generateContent: vi.fn() },
}));

vi.mock('../services/directus-crud', () => ({
  directusCrud: {
    list: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue(null),
    readMany: vi.fn().mockResolvedValue([]),
    createItem: vi.fn().mockResolvedValue({}),
    updateItem: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../services/publication-lock-manager', () => ({
  publicationLockManager: {
    isLocked: vi.fn().mockReturnValue(false),
    acquireLock: vi.fn().mockResolvedValue(true),
    releaseLock: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../services/publication-tracking', () => ({
  publicationTracker: {
    canPublish: vi.fn().mockResolvedValue(true),
    markAsProcessed: vi.fn(),
  },
}));

vi.mock('../services/social/index', () => ({
  socialPublishingService: {
    publishToPlatform: vi.fn().mockResolvedValue({
      status: 'published',
      postUrl: 'https://youtube.com/watch?v=test123',
    }),
  },
}));

vi.mock('../services/admin-token-manager', () => ({
  adminTokenManager: { getToken: vi.fn().mockResolvedValue('admin-token') },
}));

// Динамически импортируемые внутри методов планировщика
vi.mock('../services/directus-auth-manager', () => ({
  directusAuthManager: {
    getValidToken: vi.fn().mockResolvedValue('test-admin-token'),
  },
}));

vi.mock('../services/social-platforms/telegram-service', () => ({
  telegramService: {
    publishPost: vi.fn().mockResolvedValue({
      success: true,
      messageId: 42,
      postUrl: 'https://t.me/testchannel/42',
    }),
  },
}));

vi.mock('../services/social-platforms/vk-service', () => ({
  VK_DEFAULT_APP_ID: 'test_app_id',
  vkService: {
    publishPost: vi.fn().mockResolvedValue({
      success: true,
      postUrl: 'https://vk.com/wall-12345_678',
    }),
  },
}));

vi.mock('../services/social-platforms/instagram-service', () => ({
  instagramService: {
    publishPost: vi.fn().mockResolvedValue({
      success: true,
      postUrl: 'https://www.instagram.com/p/abc123',
    }),
  },
}));

vi.mock('../services/social-platforms/facebook-service', () => ({
  facebookService: {
    publishPost: vi.fn().mockResolvedValue({
      success: true,
      postId: 'fb_post_123',
      postUrl: 'https://www.facebook.com/post/123',
    }),
  },
}));

vi.mock('../services/social-platforms/threads-service', () => ({
  threadsService: {
    publishPost: vi.fn().mockResolvedValue({
      success: true,
      containerId: 'thread-cnt-1',
      postUrl: 'https://threads.net/@user/post/1',
    }),
  },
}));

vi.mock('../services/social-platforms/vk-stories-service', () => ({
  vkStoriesService: {
    publishStory: vi.fn().mockResolvedValue({
      success: true,
      storyUrl: 'https://vk.com/story/12345_678',
    }),
  },
}));

vi.mock('../services/social-platforms/vk-clips-service', () => ({
  vkClipsService: {
    publishClip: vi.fn().mockResolvedValue({
      success: true,
      videoUrl: 'https://vk.com/clip/12345_678',
    }),
  },
}));

vi.mock('../services/social-platforms/instagram-reels-service', () => ({
  instagramReelsService: {
    publishReels: vi.fn().mockResolvedValue({
      success: true,
      postUrl: 'https://www.instagram.com/reel/abc123',
    }),
  },
}));

vi.mock('../services/vk-token-refresh', () => ({
  refreshAndSaveVkToken: vi.fn().mockResolvedValue(null),
  markVkAuthExpired: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../index', () => ({
  broadcastNotification: vi.fn(),
}));

vi.mock('../utils/tiktok-oauth', () => ({
  TikTokOAuth: { refreshToken: vi.fn() },
}));

// ─── Импорты ─────────────────────────────────────────────────────────────────

import { PublishScheduler } from '../services/publish-scheduler';
import axios from 'axios';
import { directusCrud } from '../services/directus-crud';
import { telegramService } from '../services/social-platforms/telegram-service';
import { vkService } from '../services/social-platforms/vk-service';
import { instagramService } from '../services/social-platforms/instagram-service';
import { facebookService } from '../services/social-platforms/facebook-service';
import { threadsService } from '../services/social-platforms/threads-service';
import { vkStoriesService } from '../services/social-platforms/vk-stories-service';
import { vkClipsService } from '../services/social-platforms/vk-clips-service';
import { instagramReelsService } from '../services/social-platforms/instagram-reels-service';

// ─── Фабрики тестовых данных ──────────────────────────────────────────────────

function makeContent(overrides: Record<string, any> = {}): any {
  return {
    id: 'content-test-1',
    campaign_id: 'campaign-test-1',
    user_id: 'user-test-1',
    text_content: 'Тестовый пост для соцсетей',
    content: 'Тестовый пост для соцсетей',
    title: 'Тест',
    image_url: null,
    video_url: null,
    content_type: 'post',
    social_platforms: {},
    ...overrides,
  };
}

/** Мок ответа кампании с настройками всех платформ */
function makeCampaignResponse(platformSettings: Record<string, any> = {}) {
  return {
    data: {
      data: {
        id: 'campaign-test-1',
        social_media_settings: {
          telegram: { token: 'bot123:ABC', chatId: '-1001234567890', username: 'testchannel' },
          vk: { token: 'vk_token_123', groupId: '12345' },
          instagram: { accessToken: 'ig_token_123', businessAccountId: 'ig_biz_456' },
          facebook: { token: 'fb_token_123', pageId: 'fb_page_789' },
          threads: { accessToken: 'threads_token_123', threadsUserId: 'threads_uid_456' },
          ...platformSettings,
        },
      },
    },
  };
}

// ─── Вспомогательные функции ──────────────────────────────────────────────────

function makeScheduler(): PublishScheduler {
  return new PublishScheduler();
}

/** Вызывает приватный publishContentToPlatforms */
async function runPlatform(scheduler: PublishScheduler, content: any, platforms: string[]) {
  // Подавляем updateContentStatus — он делает лишние запросы к БД
  vi.spyOn(scheduler as any, 'updateContentStatus').mockResolvedValue(undefined);
  // Подавляем scheduleRetryOrFail — тестируем только результат
  vi.spyOn(scheduler as any, 'scheduleRetryOrFail').mockResolvedValue(undefined);
  return (scheduler as any).publishContentToPlatforms(content, platforms);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. РОУТИНГ — publishContentToPlatforms направляет в нужный метод
// ═══════════════════════════════════════════════════════════════════════════════

describe('PublishScheduler — роутинг по платформам', () => {
  let scheduler: PublishScheduler;

  beforeEach(() => {
    vi.clearAllMocks();
    scheduler = makeScheduler();
    vi.mocked(axios.get).mockResolvedValue(makeCampaignResponse());
    vi.mocked(directusCrud.list).mockResolvedValue([]);
    vi.mocked(directusCrud.update).mockResolvedValue({});
  });

  const routingCases: Array<{
    platform: string;
    contentType?: string;
    videoUrl?: string;
    method: string;
  }> = [
    { platform: 'telegram',   method: 'publishToTelegramDirect' },
    { platform: 'facebook',   method: 'publishToFacebookDirect' },
    { platform: 'threads',    method: 'publishToThreadsDirect' },
    { platform: 'vk',         method: 'publishToVkDirect' },
    { platform: 'vk', contentType: 'story', method: 'publishToVkStoriesDirect' },
    { platform: 'vk', contentType: 'clip',  method: 'publishToVkClipsDirect',  videoUrl: 'https://cdn.test/video.mp4' },
    { platform: 'instagram',  method: 'publishToInstagramDirect' },
    {
      platform: 'instagram',
      contentType: 'clip',
      videoUrl: 'https://cdn.test/video.mp4',
      method: 'publishToInstagramReelsDirect',
    },
    { platform: 'youtube',    method: 'publishToYouTubeDirect' },
  ];

  for (const { platform, contentType, videoUrl, method } of routingCases) {
    const desc = contentType
      ? `${platform} (content_type=${contentType}${videoUrl ? '+video_url' : ''}) → ${method}`
      : `${platform} → ${method}`;

    it(desc, async () => {
      const content = makeContent({
        content_type: contentType ?? 'post',
        video_url: videoUrl ?? null,
      });

      const spy = vi
        .spyOn(scheduler as any, method)
        .mockResolvedValue({ platform, success: true });

      await runPlatform(scheduler, content, [platform]);

      expect(spy).toHaveBeenCalledTimes(1);
      // Проверяем первый аргумент — content (независимо от числа аргументов метода)
      expect(spy.mock.calls[0][0]).toMatchObject({ id: content.id });
    });
  }

  it('неизвестная платформа → publishThroughN8nWebhook (N8N fallback)', async () => {
    const content = makeContent({ content_type: 'post' });
    const spy = vi
      .spyOn(scheduler as any, 'publishThroughN8nWebhook')
      .mockResolvedValue({ platform: 'snapchat', success: true });

    await runPlatform(scheduler, content, ['snapchat']);

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ id: content.id }),
      'snapchat',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. TELEGRAM — типы контента
// ═══════════════════════════════════════════════════════════════════════════════

describe('publishToTelegramDirect — типы контента', () => {
  let scheduler: PublishScheduler;

  beforeEach(() => {
    vi.clearAllMocks();
    scheduler = makeScheduler();
    vi.mocked(axios.get).mockResolvedValue(makeCampaignResponse());
    vi.mocked(directusCrud.list).mockResolvedValue([{ id: 'content-test-1', social_platforms: {} }]);
    vi.mocked(directusCrud.update).mockResolvedValue({});
    vi.spyOn(scheduler as any, 'scheduleRetryOrFail').mockResolvedValue(undefined);
  });

  it('текстовый пост → success=true, передаёт текст в telegramService', async () => {
    const content = makeContent();
    const result = await (scheduler as any).publishToTelegramDirect(content);

    expect(result).toMatchObject({ platform: 'telegram', success: true });
    expect(vi.mocked(telegramService.publishPost)).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'bot123:ABC', chatId: '-1001234567890' }),
      expect.objectContaining({ text: content.text_content }),
    );
  });

  it('пост с image_url → передаёт imageUrl в telegramService', async () => {
    const content = makeContent({ image_url: 'https://cdn.test/photo.jpg' });
    const result = await (scheduler as any).publishToTelegramDirect(content);

    expect(result.success).toBe(true);
    expect(vi.mocked(telegramService.publishPost)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ imageUrl: 'https://cdn.test/photo.jpg' }),
    );
  });

  it('пост с video_url → передаёт videoUrl в telegramService', async () => {
    const content = makeContent({ video_url: 'https://cdn.test/video.mp4' });
    const result = await (scheduler as any).publishToTelegramDirect(content);

    expect(result.success).toBe(true);
    expect(vi.mocked(telegramService.publishPost)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ videoUrl: 'https://cdn.test/video.mp4' }),
    );
  });

  it('ошибка telegramService → success=false', async () => {
    vi.mocked(telegramService.publishPost).mockResolvedValue({
      success: false,
      error: 'Bad Request: chat not found',
    } as any);

    const result = await (scheduler as any).publishToTelegramDirect(makeContent());
    expect(result).toMatchObject({ platform: 'telegram', success: false });
    expect(result.error).toMatch(/chat not found/i);
  });

  it('нет campaign_id → success=false', async () => {
    const content = makeContent({ campaign_id: undefined });
    const result = await (scheduler as any).publishToTelegramDirect(content);
    expect(result).toMatchObject({ platform: 'telegram', success: false });
  });

  it('Telegram не настроен в кампании → success=false', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: { data: { social_media_settings: { telegram: null } } },
    });
    const result = await (scheduler as any).publishToTelegramDirect(makeContent());
    expect(result).toMatchObject({ platform: 'telegram', success: false });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. VK — типы контента
// ═══════════════════════════════════════════════════════════════════════════════

describe('publishToVkDirect — типы контента', () => {
  let scheduler: PublishScheduler;

  beforeEach(() => {
    vi.clearAllMocks();
    scheduler = makeScheduler();
    vi.mocked(axios.get).mockResolvedValue(makeCampaignResponse());
    vi.mocked(directusCrud.list).mockResolvedValue([{ id: 'content-test-1', social_platforms: {} }]);
    vi.mocked(directusCrud.update).mockResolvedValue({});
    vi.spyOn(scheduler as any, 'scheduleRetryOrFail').mockResolvedValue(undefined);
  });

  it('текстовый пост → success=true, передаёт текст в vkService', async () => {
    const content = makeContent();
    const result = await (scheduler as any).publishToVkDirect(content);

    expect(result).toMatchObject({ platform: 'vk', success: true });
    expect(vi.mocked(vkService.publishPost)).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'vk_token_123', groupId: '12345' }),
      expect.objectContaining({ text: content.text_content }),
    );
  });

  it('пост с image_url → передаёт imageUrl в vkService', async () => {
    const content = makeContent({ image_url: 'https://cdn.test/photo.jpg' });
    const result = await (scheduler as any).publishToVkDirect(content);

    expect(result.success).toBe(true);
    expect(vi.mocked(vkService.publishPost)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ imageUrl: 'https://cdn.test/photo.jpg' }),
    );
  });

  it('пост с video_url → передаёт videoUrl в vkService', async () => {
    const content = makeContent({ video_url: 'https://cdn.test/video.mp4' });
    const result = await (scheduler as any).publishToVkDirect(content);

    expect(result.success).toBe(true);
    expect(vi.mocked(vkService.publishPost)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ videoUrl: 'https://cdn.test/video.mp4' }),
    );
  });

  it('ошибка vkService → success=false', async () => {
    vi.mocked(vkService.publishPost).mockResolvedValue({
      success: false,
      error: 'VK API Error 5: User authorization failed',
    } as any);

    const result = await (scheduler as any).publishToVkDirect(makeContent());
    expect(result).toMatchObject({ platform: 'vk', success: false });
    expect(result.error).toMatch(/authorization failed/i);
  });

  it('VK не настроен в кампании → success=false', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: { data: { social_media_settings: { vk: { token: '', groupId: '' } } } },
    });
    const result = await (scheduler as any).publishToVkDirect(makeContent());
    expect(result).toMatchObject({ platform: 'vk', success: false });
  });

  it('нет campaign_id → success=false', async () => {
    const result = await (scheduler as any).publishToVkDirect(makeContent({ campaign_id: undefined }));
    expect(result).toMatchObject({ platform: 'vk', success: false });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. VK STORIES
// ═══════════════════════════════════════════════════════════════════════════════

describe('publishToVkStoriesDirect', () => {
  let scheduler: PublishScheduler;

  beforeEach(() => {
    vi.clearAllMocks();
    scheduler = makeScheduler();
    vi.spyOn(scheduler as any, 'scheduleRetryOrFail').mockResolvedValue(undefined);
  });

  it('успешная публикация → success=true', async () => {
    const result = await (scheduler as any).publishToVkStoriesDirect(makeContent({ content_type: 'story' }));
    expect(result).toMatchObject({ platform: 'vk', success: true });
    expect(vi.mocked(vkStoriesService.publishStory)).toHaveBeenCalledWith(
      'content-test-1',
      expect.anything(),
      expect.objectContaining({ id: 'content-test-1' }),
    );
  });

  it('ошибка vkStoriesService → success=false', async () => {
    vi.mocked(vkStoriesService.publishStory).mockResolvedValue({
      success: false,
      error: 'VK Stories API error: upload failed',
    } as any);

    const result = await (scheduler as any).publishToVkStoriesDirect(makeContent({ content_type: 'story' }));
    expect(result).toMatchObject({ platform: 'vk', success: false });
    expect(result.error).toMatch(/upload failed/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. VK CLIPS
// ═══════════════════════════════════════════════════════════════════════════════

describe('publishToVkClipsDirect', () => {
  let scheduler: PublishScheduler;

  beforeEach(() => {
    vi.clearAllMocks();
    scheduler = makeScheduler();
    vi.spyOn(scheduler as any, 'scheduleRetryOrFail').mockResolvedValue(undefined);
  });

  it('успешная публикация с video_url → success=true', async () => {
    const content = makeContent({ content_type: 'clip', video_url: 'https://cdn.test/clip.mp4' });
    const result = await (scheduler as any).publishToVkClipsDirect(content);

    expect(result).toMatchObject({ platform: 'vk', success: true });
    expect(vi.mocked(vkClipsService.publishClip)).toHaveBeenCalledWith(
      'content-test-1',
      expect.anything(),
    );
  });

  it('нет video_url → success=false, vkClipsService не вызывается', async () => {
    const content = makeContent({ content_type: 'clip', video_url: null });
    const result = await (scheduler as any).publishToVkClipsDirect(content);

    expect(result).toMatchObject({ platform: 'vk', success: false });
    expect(result.error).toMatch(/video_url/i);
    expect(vi.mocked(vkClipsService.publishClip)).not.toHaveBeenCalled();
  });

  it('ошибка vkClipsService → success=false', async () => {
    vi.mocked(vkClipsService.publishClip).mockResolvedValue({
      success: false,
      error: 'VK Clips: upload server error',
    } as any);

    const content = makeContent({ content_type: 'clip', video_url: 'https://cdn.test/clip.mp4' });
    const result = await (scheduler as any).publishToVkClipsDirect(content);

    expect(result).toMatchObject({ platform: 'vk', success: false });
    expect(result.error).toMatch(/upload server error/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. INSTAGRAM — обычный пост и Reels
// ═══════════════════════════════════════════════════════════════════════════════

describe('publishToInstagramDirect', () => {
  let scheduler: PublishScheduler;

  beforeEach(() => {
    vi.clearAllMocks();
    scheduler = makeScheduler();
    vi.mocked(axios.get).mockResolvedValue(makeCampaignResponse());
    vi.mocked(directusCrud.list).mockResolvedValue([{ id: 'content-test-1', social_platforms: {} }]);
    vi.mocked(directusCrud.update).mockResolvedValue({});
    vi.spyOn(scheduler as any, 'scheduleRetryOrFail').mockResolvedValue(undefined);
  });

  it('пост с image_url → success=true', async () => {
    const content = makeContent({ image_url: 'https://cdn.test/photo.jpg' });
    const result = await (scheduler as any).publishToInstagramDirect(content);

    expect(result).toMatchObject({ platform: 'instagram', success: true });
    expect(vi.mocked(instagramService.publishPost)).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'ig_token_123' }),
      expect.objectContaining({ imageUrl: 'https://cdn.test/photo.jpg' }),
      expect.any(String),
      expect.anything(),
    );
  });

  it('текстовый пост (без фото) → вызывает instagramService', async () => {
    const result = await (scheduler as any).publishToInstagramDirect(makeContent());
    expect(result.platform).toBe('instagram');
    expect(vi.mocked(instagramService.publishPost)).toHaveBeenCalledTimes(1);
  });

  it('ошибка instagramService → success=false', async () => {
    vi.mocked(instagramService.publishPost).mockResolvedValue({
      success: false,
      error: 'Instagram: invalid access token',
    } as any);

    const result = await (scheduler as any).publishToInstagramDirect(makeContent());
    expect(result).toMatchObject({ platform: 'instagram', success: false });
    expect(result.error).toMatch(/invalid access token/i);
  });

  it('Instagram не настроен → success=false', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: { data: { social_media_settings: { instagram: null } } },
    });
    const result = await (scheduler as any).publishToInstagramDirect(makeContent());
    expect(result).toMatchObject({ platform: 'instagram', success: false });
  });

  it('нет campaign_id → success=false', async () => {
    const result = await (scheduler as any).publishToInstagramDirect(
      makeContent({ campaign_id: undefined }),
    );
    expect(result).toMatchObject({ platform: 'instagram', success: false });
  });
});

describe('publishToInstagramReelsDirect', () => {
  let scheduler: PublishScheduler;

  beforeEach(() => {
    vi.clearAllMocks();
    scheduler = makeScheduler();
    vi.spyOn(scheduler as any, 'scheduleRetryOrFail').mockResolvedValue(undefined);
  });

  it('video_url есть → success=true', async () => {
    const content = makeContent({ content_type: 'clip', video_url: 'https://cdn.test/reel.mp4' });
    const result = await (scheduler as any).publishToInstagramReelsDirect(content);

    expect(result).toMatchObject({ platform: 'instagram', success: true });
    expect(vi.mocked(instagramReelsService.publishReels)).toHaveBeenCalledWith(
      'content-test-1',
      expect.anything(),
    );
  });

  it('нет video_url → success=false, Reels не вызывается', async () => {
    const content = makeContent({ content_type: 'clip', video_url: null });
    const result = await (scheduler as any).publishToInstagramReelsDirect(content);

    expect(result).toMatchObject({ platform: 'instagram', success: false });
    expect(result.error).toMatch(/video_url/i);
    expect(vi.mocked(instagramReelsService.publishReels)).not.toHaveBeenCalled();
  });

  it('ошибка instagramReelsService → success=false', async () => {
    vi.mocked(instagramReelsService.publishReels).mockResolvedValue({
      success: false,
      error: 'Reels: processing failed',
    } as any);

    const content = makeContent({ content_type: 'clip', video_url: 'https://cdn.test/reel.mp4' });
    const result = await (scheduler as any).publishToInstagramReelsDirect(content);

    expect(result).toMatchObject({ platform: 'instagram', success: false });
    expect(result.error).toMatch(/processing failed/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. FACEBOOK
// ═══════════════════════════════════════════════════════════════════════════════

describe('publishToFacebookDirect', () => {
  let scheduler: PublishScheduler;

  beforeEach(() => {
    vi.clearAllMocks();
    scheduler = makeScheduler();
    vi.mocked(axios.get).mockResolvedValue(makeCampaignResponse());
    vi.mocked(directusCrud.list).mockResolvedValue([{ id: 'content-test-1', social_platforms: {} }]);
    vi.mocked(directusCrud.update).mockResolvedValue({});
    vi.spyOn(scheduler as any, 'scheduleRetryOrFail').mockResolvedValue(undefined);
  });

  it('текст + image_url → success=true', async () => {
    const content = makeContent({ image_url: 'https://cdn.test/photo.jpg' });
    const result = await (scheduler as any).publishToFacebookDirect(content);

    expect(result).toMatchObject({ platform: 'facebook', success: true });
    expect(vi.mocked(facebookService.publishPost)).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'fb_token_123', pageId: 'fb_page_789' }),
      expect.objectContaining({
        text: content.text_content,
        imageUrl: 'https://cdn.test/photo.jpg',
      }),
    );
  });

  it('только текст (без фото) → success=true', async () => {
    const result = await (scheduler as any).publishToFacebookDirect(makeContent());

    expect(result).toMatchObject({ platform: 'facebook', success: true });
    expect(vi.mocked(facebookService.publishPost)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ text: 'Тестовый пост для соцсетей' }),
    );
  });

  it('пост с video_url → передаёт videoUrl', async () => {
    const content = makeContent({ video_url: 'https://cdn.test/video.mp4' });
    const result = await (scheduler as any).publishToFacebookDirect(content);

    expect(result.success).toBe(true);
    expect(vi.mocked(facebookService.publishPost)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ videoUrl: 'https://cdn.test/video.mp4' }),
    );
  });

  it('ошибка facebookService → success=false', async () => {
    vi.mocked(facebookService.publishPost).mockResolvedValue({
      success: false,
      error: 'Facebook: (#200) Requires manage_pages permission',
    } as any);

    const result = await (scheduler as any).publishToFacebookDirect(makeContent());
    expect(result).toMatchObject({ platform: 'facebook', success: false });
    expect(result.error).toMatch(/manage_pages/i);
  });

  it('Facebook не настроен → success=false', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: { data: { social_media_settings: { facebook: { token: '', pageId: '' } } } },
    });
    const result = await (scheduler as any).publishToFacebookDirect(makeContent());
    expect(result).toMatchObject({ platform: 'facebook', success: false });
  });

  it('нет campaign_id → success=false', async () => {
    const result = await (scheduler as any).publishToFacebookDirect(
      makeContent({ campaign_id: undefined }),
    );
    expect(result).toMatchObject({ platform: 'facebook', success: false });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. THREADS
// ═══════════════════════════════════════════════════════════════════════════════

describe('publishToThreadsDirect', () => {
  let scheduler: PublishScheduler;

  beforeEach(() => {
    vi.clearAllMocks();
    scheduler = makeScheduler();
    vi.mocked(axios.get).mockResolvedValue(makeCampaignResponse());
    vi.mocked(directusCrud.list).mockResolvedValue([{ id: 'content-test-1', social_platforms: {} }]);
    vi.mocked(directusCrud.update).mockResolvedValue({});
    vi.spyOn(scheduler as any, 'scheduleRetryOrFail').mockResolvedValue(undefined);
  });

  it('текстовый пост → success=true', async () => {
    const result = await (scheduler as any).publishToThreadsDirect(makeContent());

    expect(result).toMatchObject({ platform: 'threads', success: true });
    expect(vi.mocked(threadsService.publishPost)).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'threads_token_123',
        threadsUserId: 'threads_uid_456',
      }),
      expect.objectContaining({ text: 'Тестовый пост для соцсетей' }),
    );
  });

  it('пост с image_url → передаёт imageUrl', async () => {
    const content = makeContent({ image_url: 'https://cdn.test/photo.jpg' });
    const result = await (scheduler as any).publishToThreadsDirect(content);

    expect(result.success).toBe(true);
    expect(vi.mocked(threadsService.publishPost)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ imageUrl: 'https://cdn.test/photo.jpg' }),
    );
  });

  it('пост с video_url → передаёт videoUrl', async () => {
    const content = makeContent({ video_url: 'https://cdn.test/video.mp4' });
    const result = await (scheduler as any).publishToThreadsDirect(content);

    expect(result.success).toBe(true);
    expect(vi.mocked(threadsService.publishPost)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ videoUrl: 'https://cdn.test/video.mp4' }),
    );
  });

  it('ошибка threadsService → success=false', async () => {
    vi.mocked(threadsService.publishPost).mockResolvedValue({
      success: false,
      error: 'Threads: app under review',
    } as any);

    const result = await (scheduler as any).publishToThreadsDirect(makeContent());
    expect(result).toMatchObject({ platform: 'threads', success: false });
    expect(result.error).toMatch(/under review/i);
  });

  it('Threads не настроен → success=false', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: {
        data: {
          social_media_settings: {
            threads: { accessToken: null, threadsUserId: null },
          },
        },
      },
    });
    const result = await (scheduler as any).publishToThreadsDirect(makeContent());
    expect(result).toMatchObject({ platform: 'threads', success: false });
  });

  it('нет campaign_id → success=false', async () => {
    const result = await (scheduler as any).publishToThreadsDirect(
      makeContent({ campaign_id: undefined }),
    );
    expect(result).toMatchObject({ platform: 'threads', success: false });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. YouTube
// ═══════════════════════════════════════════════════════════════════════════════

describe('publishToYouTubeDirect', () => {
  let scheduler: PublishScheduler;

  beforeEach(() => {
    vi.clearAllMocks();
    scheduler = makeScheduler();
    vi.mocked(directusCrud.getById).mockResolvedValue({
      id: 'campaign-test-1',
      social_media_settings: {},
    });
    vi.mocked(directusCrud.update).mockResolvedValue({});
    vi.spyOn(scheduler as any, 'scheduleRetryOrFail').mockResolvedValue(undefined);
    vi.spyOn(scheduler as any, 'getCampaignData').mockResolvedValue({
      id: 'campaign-test-1',
      social_media_settings: {},
    });
  });

  it('успешная публикация → success=true', async () => {
    const content = makeContent({ video_url: 'https://cdn.test/video.mp4' });
    const result = await (scheduler as any).publishToYouTubeDirect(content, 'test-token');

    expect(result).toMatchObject({ platform: 'youtube', success: true });
  });

  it('нет данных кампании → success=false', async () => {
    vi.spyOn(scheduler as any, 'getCampaignData').mockResolvedValue(null);

    const result = await (scheduler as any).publishToYouTubeDirect(makeContent(), 'test-token');
    expect(result).toMatchObject({ platform: 'youtube', success: false });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. Вспомогательные — getContentType
// ═══════════════════════════════════════════════════════════════════════════════

describe('getContentType — определение типа контента', () => {
  let scheduler: PublishScheduler;

  beforeEach(() => {
    scheduler = makeScheduler();
  });

  it('content_type="story" → "story"', () => {
    expect((scheduler as any).getContentType({ content_type: 'story' })).toBe('story');
  });

  it('content_type="clip" → "clip"', () => {
    expect((scheduler as any).getContentType({ content_type: 'clip' })).toBe('clip');
  });

  it('content_type="post" → "post"', () => {
    expect((scheduler as any).getContentType({ content_type: 'post' })).toBe('post');
  });

  it('нет content_type, но metadata.storyType → берёт из metadata', () => {
    const content = { metadata: { storyType: 'story' } };
    expect((scheduler as any).getContentType(content)).toBe('story');
  });

  it('нет content_type и нет metadata → "post" по умолчанию', () => {
    expect((scheduler as any).getContentType({})).toBe('post');
  });

  it('content_type в ВЕРХНЕМ регистре → нормализуется в нижний', () => {
    expect((scheduler as any).getContentType({ content_type: 'CLIP' })).toBe('clip');
  });
});
