import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatusValidator, statusValidator } from '../services/status-validator';

vi.mock('../services/directus-crud', () => ({
  directusCrud: {
    getById: vi.fn(),
  },
}));

vi.mock('../services/social-platforms/facebook-service', () => ({
  facebookService: { validateToken: vi.fn() },
}));

vi.mock('../services/social-platforms/instagram-reels-service', () => ({
  instagramReelsService: { validateToken: vi.fn() },
}));

vi.mock('../services/social-platforms/vk-stories-service', () => ({
  vkStoriesService: { validateToken: vi.fn() },
}));

vi.mock('../services/social-platforms/tiktok-service', () => ({
  tiktokService: { validateToken: vi.fn() },
}));

vi.mock('../services/social-platforms/vk-clips-service', () => ({
  vkClipsService: { validateToken: vi.fn() },
}));

vi.mock('../services/social-platforms/youtube-service', () => ({
  YouTubeService: class MockYouTubeService {
    validateToken = vi.fn().mockResolvedValue({ isValid: true });
  },
}));

vi.mock('../telegram-bot/bot-launcher', () => ({
  getTelegramBot: vi.fn().mockReturnValue(null),
}));

import { directusCrud } from '../services/directus-crud';

describe('StatusValidator', () => {
  const validator = new StatusValidator();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('должен возвращать error при отсутствии кампании', async () => {
    vi.mocked(directusCrud.getById).mockResolvedValue(null);

    const result = await validator.validateCampaignTokens('invalid-id');

    expect(result).toEqual({ error: 'Кампания не найдена' });
    expect(directusCrud.getById).toHaveBeenCalledWith(
      'user_campaigns',
      'invalid-id',
      { useAdminToken: true }
    );
  });

  it('должен возвращать пустой results для кампании без social settings', async () => {
    vi.mocked(directusCrud.getById).mockResolvedValue({
      id: 'camp-1',
      name: 'Test Campaign',
      social_settings: {},
    });

    const result = await validator.validateCampaignTokens('camp-1');

    expect(result).toEqual({});
    expect(directusCrud.getById).toHaveBeenCalledWith(
      'user_campaigns',
      'camp-1',
      { useAdminToken: true }
    );
  });

  it('должен валидировать Facebook токен когда он есть', async () => {
    const { facebookService } = await import('../services/social-platforms/facebook-service');
    vi.mocked(directusCrud.getById).mockResolvedValue({
      id: 'camp-1',
      name: 'Test',
      user_id: 'user-1',
      social_settings: { facebook: { token: 'fb-token' } },
    });
    vi.mocked(facebookService.validateToken).mockResolvedValue({
      isValid: true,
    });

    const result = await validator.validateCampaignTokens('camp-1');

    expect(result).toHaveProperty('facebook');
    expect(result.facebook).toEqual({ isValid: true });
    expect(facebookService.validateToken).toHaveBeenCalledWith({
      token: 'fb-token',
    });
  });

  it('должен валидировать Instagram при наличии token или accessToken', async () => {
    const { instagramReelsService } = await import(
      '../services/social-platforms/instagram-reels-service'
    );
    vi.mocked(directusCrud.getById).mockResolvedValue({
      id: 'camp-1',
      name: 'Test',
      user_id: 'user-1',
      social_settings: { instagram: { accessToken: 'ig-token' } },
    });
    vi.mocked(instagramReelsService.validateToken).mockResolvedValue({
      isValid: true,
    });

    const result = await validator.validateCampaignTokens('camp-1');

    expect(result).toHaveProperty('instagram');
    expect(result.instagram).toEqual({ isValid: true });
  });

  it('должен валидировать VK при наличии токена', async () => {
    const { vkStoriesService } = await import(
      '../services/social-platforms/vk-stories-service'
    );
    vi.mocked(directusCrud.getById).mockResolvedValue({
      id: 'camp-1',
      name: 'Test',
      user_id: 'user-1',
      social_settings: { vk: { token: 'vk-token' } },
    });
    vi.mocked(vkStoriesService.validateToken).mockResolvedValue({
      isValid: false,
      error: 'Token expired',
    });

    const result = await validator.validateCampaignTokens('camp-1');

    expect(result).toHaveProperty('vk');
    expect(result.vk.isValid).toBe(false);
    expect(result.vk.error).toBe('Token expired');
  });

  it('должен возвращать error при исключении из directusCrud', async () => {
    vi.mocked(directusCrud.getById).mockRejectedValue(
      new Error('Directus connection failed')
    );

    const result = await validator.validateCampaignTokens('camp-1');

    expect(result).toEqual({ error: 'Directus connection failed' });
  });

  it('должен использовать social_media_settings как альтернативу social_settings', async () => {
    const { facebookService } = await import('../services/social-platforms/facebook-service');
    vi.mocked(directusCrud.getById).mockResolvedValue({
      id: 'camp-1',
      name: 'Test',
      user_id: 'user-1',
      social_media_settings: { facebook: { token: 'fb-token' } },
    });
    vi.mocked(facebookService.validateToken).mockResolvedValue({
      isValid: true,
    });

    const result = await validator.validateCampaignTokens('camp-1');

    expect(result).toHaveProperty('facebook');
    expect(facebookService.validateToken).toHaveBeenCalledWith({
      token: 'fb-token',
    });
  });

  it('startValidation не должен выбрасывать', async () => {
    await expect(validator.startValidation()).resolves.toBeUndefined();
  });

  it('statusValidator должен быть инстансом StatusValidator', () => {
    expect(statusValidator).toBeInstanceOf(StatusValidator);
  });
});
