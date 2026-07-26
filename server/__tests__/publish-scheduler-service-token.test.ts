/**
 * Инвариант: ВСЕ публикации планировщика ходят в Directus сервисным токеном.
 *
 * До этого фикса Threads/Facebook/Telegram/VK/Instagram сначала брали токен
 * пользователя и только потом сервисный, а stories/clips/reels/YouTube — сразу
 * сервисный. Пользовательский токен валиден, но прав на чужую кампанию не имеет:
 * Directus отвечает 403, и публикация падала с «Ошибка загрузки кампании …: HTTP 403»
 * при полностью рабочем сервисном доступе.
 *
 * Тест перебирает каждый публикующий метод — чтобы новая платформа не могла
 * тихо вернуть старое поведение.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const SERVICE_TOKEN = 'service-token-for-publishing';
const USER_TOKEN = 'user-token-must-not-be-used';

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
vi.mock('../utils/n8n-utils', () => ({ getN8nUrl: vi.fn().mockReturnValue('http://n8n.test') }));
vi.mock('../services/ai-service', () => ({ aiService: { generateContent: vi.fn() } }));
vi.mock('../utils/content-cache', () => ({ invalidateContentCache: vi.fn() }));

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
  publicationTracker: { canPublish: vi.fn().mockResolvedValue(true), markAsProcessed: vi.fn() },
}));
vi.mock('../services/social/index', () => ({
  socialPublishingService: { publishToPlatform: vi.fn().mockResolvedValue({ status: 'published' }) },
}));
vi.mock('../services/admin-token-manager', () => ({
  adminTokenManager: { getToken: vi.fn().mockResolvedValue('admin-token') },
}));

// Пользовательский токен доступен — и всё равно не должен быть использован.
const getValidToken = vi.fn().mockResolvedValue(USER_TOKEN);
vi.mock('../services/directus-auth-manager', () => ({
  directusAuthManager: {
    getValidToken: (...args: any[]) => getValidToken(...args),
    getAdminAuthToken: vi.fn().mockResolvedValue('manager-admin-token'),
  },
}));

const publishOk = (extra: Record<string, any> = {}) =>
  vi.fn().mockResolvedValue({ success: true, postUrl: 'https://example.test/post/1', ...extra });

vi.mock('../services/social-platforms/telegram-service', () => ({
  telegramService: { publishPost: publishOk({ messageId: 42 }) },
}));
vi.mock('../services/social-platforms/vk-service', () => ({
  VK_DEFAULT_APP_ID: 'test_app_id',
  vkService: { publishPost: publishOk({ postId: 678 }) },
}));
vi.mock('../services/social-platforms/instagram-service', () => ({
  instagramService: { publishPost: publishOk() },
}));
vi.mock('../services/social-platforms/facebook-service', () => ({
  facebookService: { publishPost: publishOk({ postId: 'fb_1' }) },
}));
vi.mock('../services/social-platforms/threads-service', () => ({
  threadsService: { publishPost: publishOk({ containerId: 'c1' }) },
}));
vi.mock('../services/social-platforms/vk-stories-service', () => ({
  vkStoriesService: { publishStory: vi.fn().mockResolvedValue({ success: true, storyUrl: 'https://vk.com/story/1' }) },
}));
vi.mock('../services/social-platforms/vk-clips-service', () => ({
  vkClipsService: { publishClip: vi.fn().mockResolvedValue({ success: true, videoUrl: 'https://vk.com/clip/1' }) },
}));
vi.mock('../services/social-platforms/instagram-reels-service', () => ({
  instagramReelsService: { publishReels: vi.fn().mockResolvedValue({ success: true, postUrl: 'https://instagram.com/reel/1' }) },
}));
vi.mock('../services/vk-token-refresh', () => ({
  refreshAndSaveVkToken: vi.fn().mockResolvedValue(null),
  markVkAuthExpired: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../index', () => ({ broadcastNotification: vi.fn() }));
vi.mock('../utils/tiktok-oauth', () => ({ TikTokOAuth: { refreshToken: vi.fn() } }));

import { PublishScheduler } from '../services/publish-scheduler';
import axios from 'axios';
import { vkStoriesService } from '../services/social-platforms/vk-stories-service';
import { vkClipsService } from '../services/social-platforms/vk-clips-service';
import { instagramReelsService } from '../services/social-platforms/instagram-reels-service';

function makeContent(overrides: Record<string, any> = {}): any {
  return {
    id: 'content-1',
    campaign_id: 'campaign-1',
    user_id: 'user-1',
    text_content: 'Тестовый пост',
    content: 'Тестовый пост',
    title: 'Тест',
    image_url: null,
    video_url: null,
    content_type: 'post',
    social_platforms: {},
    ...overrides,
  };
}

/** Настройки всех платформ разом — чтобы каждый метод дошёл до публикации. */
const CAMPAIGN = {
  data: {
    data: {
      social_media_settings: {
        telegram: { token: 'tg', chatId: '@ch' },
        vk: { token: 'vk', groupId: '123' },
        instagram: { accessToken: 'ig', businessAccountId: 'biz' },
        facebook: { token: 'fb', pageId: 'page' },
        threads: { accessToken: 'th', threadsUserId: 'uid' },
      },
    },
  },
};

/** Заголовок Authorization последнего GET к user_campaigns. */
function campaignFetchAuthHeaders(): string[] {
  return (axios.get as any).mock.calls
    .filter(([url]: any[]) => String(url).includes('/items/user_campaigns/'))
    .map(([, cfg]: any[]) => cfg?.headers?.Authorization);
}

describe('Публикация ходит сервисным токеном — все платформы', () => {
  let scheduler: any;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DIRECTUS_URL = 'http://directus.test';
    process.env.DIRECTUS_STATIC_TOKEN = SERVICE_TOKEN;
    getValidToken.mockResolvedValue(USER_TOKEN);
    (axios.get as any).mockResolvedValue(CAMPAIGN);
    scheduler = new PublishScheduler();
  });

  const platformMethods: Array<{ name: string; method: string; content?: Record<string, any> }> = [
    { name: 'Telegram', method: 'publishToTelegramDirect' },
    { name: 'VK', method: 'publishToVkDirect' },
    { name: 'Instagram', method: 'publishToInstagramDirect' },
    { name: 'Facebook', method: 'publishToFacebookDirect' },
    { name: 'Threads', method: 'publishToThreadsDirect' },
  ];

  for (const { name, method } of platformMethods) {
    it(`${name}: кампания читается сервисным токеном`, async () => {
      await scheduler[method](makeContent());
      const auths = campaignFetchAuthHeaders();
      expect(auths.length).toBeGreaterThan(0);
      for (const auth of auths) {
        expect(auth).toBe(`Bearer ${SERVICE_TOKEN}`);
      }
    });

    it(`${name}: токен пользователя не запрашивается`, async () => {
      await scheduler[method](makeContent());
      expect(getValidToken).not.toHaveBeenCalled();
    });

    it(`${name}: публикует и за пользователя без живой сессии`, async () => {
      // Ровно тот случай, который ломался: сессии владельца нет.
      getValidToken.mockResolvedValue(null);
      const result = await scheduler[method](makeContent());
      expect(result.success).toBe(true);
    });
  }

  const mediaMethods: Array<{ name: string; method: string; service: any; fn: string; content: Record<string, any> }> = [
    { name: 'VK Stories', method: 'publishToVkStoriesDirect', service: vkStoriesService, fn: 'publishStory', content: { content_type: 'story' } },
    { name: 'VK Clips', method: 'publishToVkClipsDirect', service: vkClipsService, fn: 'publishClip', content: { content_type: 'clip', video_url: 'https://cdn.test/v.mp4' } },
    { name: 'Instagram Reels', method: 'publishToInstagramReelsDirect', service: instagramReelsService, fn: 'publishReels', content: { content_type: 'clip', video_url: 'https://cdn.test/v.mp4' } },
  ];

  for (const { name, method, service, fn, content } of mediaMethods) {
    it(`${name}: сервисный токен передаётся в сервис публикации`, async () => {
      await scheduler[method](makeContent(content));
      expect((service as any)[fn]).toHaveBeenCalled();
      const args = (service as any)[fn].mock.calls[0];
      expect(args).toContain(SERVICE_TOKEN);
      expect(args).not.toContain(USER_TOKEN);
      expect(getValidToken).not.toHaveBeenCalled();
    });
  }

  it('без сервисного токена в env публикация не подставляет пользовательский', async () => {
    delete process.env.DIRECTUS_STATIC_TOKEN;
    await scheduler.publishToTelegramDirect(makeContent());
    for (const auth of campaignFetchAuthHeaders()) {
      expect(auth).not.toBe(`Bearer ${USER_TOKEN}`);
    }
    expect(getValidToken).not.toHaveBeenCalled();
  });
});
