import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock axios BEFORE anything else
vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
    patch: vi.fn(),
    create: vi.fn().mockReturnValue({
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() }
      }
    })
  }
}));

import axios from 'axios';
import { getPublishScheduler } from '../services/publish-scheduler';
import { directusCrud } from '../services/directus-crud';
import { publicationLockManager } from '../services/publication-lock-manager';
import { publicationTracker } from '../services/publication-tracking';
vi.mock('../utils/logger');
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

describe('Integration: PublishScheduler Protection & Workflow', () => {
  const scheduler = getPublishScheduler();

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DIRECTUS_URL = 'http://directus.test';
    // Clear private cache
    // @ts-ignore
    scheduler.processedContentCache.clear();
  });

  /**
   * EDGE CASE: "Double Action Prevention"
   * Проверяем, что планировщик не запустит публикацию на одну платформу дважды,
   * если она уже есть в локальном кэше (Level 1 protection).
   */
  it('should block duplicate publishing via Level 1 cache', async () => {
    const mockContent = [{
      id: 'c-1',
      status: 'scheduled',
      social_platforms: { telegram: { status: 'pending', selected: true } }
    }];

    vi.mocked(directusCrud.list).mockResolvedValueOnce(mockContent);
    
    // Manual injection into private cache to simulate previous run
    // @ts-ignore
    scheduler.markAsProcessed('c-1', 'telegram');

    await scheduler.checkScheduledContent();

    // Axios should NOT be called for n8n webhook
    expect(axios.post).not.toHaveBeenCalled();
  });

  /**
   * INTEGRATION: "Scheduler direct publish flow"
   * Проверяем, что планировщик правильно определяет прошедшее время и вызывает
   * publishToTelegramDirect (все платформы теперь публикуются напрямую, без N8N).
   */
  it('should trigger direct publish if scheduled time has passed', async () => {
    const pastDate = new Date(Date.now() - 10000).toISOString();
    const mockContent = [{
      id: 'c-2',
      status: 'scheduled',
      social_platforms: { 
        telegram: { status: 'scheduled', scheduledAt: pastDate, selected: true } 
      }
    }];

    vi.mocked(directusCrud.list)
      .mockResolvedValueOnce(mockContent)  // checkScheduledContent list
      .mockResolvedValueOnce(mockContent); // updateContentStatus list

    // Мокируем publishToTelegramDirect — Telegram теперь публикуется напрямую без N8N
    // @ts-ignore
    const spyTelegram = vi.spyOn(scheduler, 'publishToTelegramDirect')
      .mockResolvedValue({ platform: 'telegram', success: true });

    await scheduler.checkScheduledContent();

    expect(spyTelegram).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c-2' })
    );
  });

  /**
   * EDGE CASE: "Status Desync Protection"
   * Если одна платформа опубликована, а вторая упала, общий статус контента 
   * должен стать 'partially_published', а не 'published'.
   */
  it('should update content status to partially_published if some platforms remain', async () => {
    const mockContentId = 'c-3';
    const mockPlatforms = {
      telegram: { status: 'published', postUrl: 'http://t.me/1' },
      vk: { status: 'pending', selected: true }
    };

    // Mock directus list returning partially published state
    vi.mocked(directusCrud.list).mockResolvedValueOnce([{
      id: mockContentId,
      status: 'scheduled',
      social_platforms: mockPlatforms
    }]);

    // Use internal private method to test status calculation logic
    // @ts-ignore
    await scheduler.updateContentStatus(mockContentId);

    expect(directusCrud.update).toHaveBeenCalledWith(
      'campaign_content',
      mockContentId,
      expect.objectContaining({ status: 'partially_published' }),
      expect.any(Object)
    );
  });
});
