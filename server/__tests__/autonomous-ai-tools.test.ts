import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies BEFORE imports
vi.mock('axios', () => {
  const instance = Object.assign(vi.fn().mockResolvedValue({ data: {} }), {
    get: vi.fn().mockResolvedValue({ data: {} }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
    interceptors: {
      request: { use: vi.fn(), eject: vi.fn() },
      response: { use: vi.fn(), eject: vi.fn() },
    },
  });
  return {
    default: {
      create: vi.fn().mockReturnValue(instance),
      get: vi.fn().mockResolvedValue({ data: {} }),
      post: vi.fn().mockResolvedValue({ data: {} }),
    },
  };
});

vi.mock('../services/directus-crud', () => ({
  directusCrud: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateItem: vi.fn()
  }
}));

vi.mock('../services/web-crawler-agent', () => ({
  webCrawlerAgent: {
    intelligentCrawl: vi.fn(),
    analyzePageContent: vi.fn()
  }
}));

vi.mock('../services/gemini-direct', () => ({
  geminiDirect: {
    generateContent: vi.fn()
  }
}));

import { TOOL_IMPLEMENTATIONS } from '../services/autonomous-ai';
import axios from 'axios';
import { directusCrud } from '../services/directus-crud';
import { webCrawlerAgent } from '../services/web-crawler-agent';
import { geminiDirect } from '../services/gemini-direct';

describe('AutonomousAI Tool Implementations', () => {
  const mockRequest: any = {
    userId: 'user-1',
    campaignId: 'camp-1',
    authToken: 'token-123'
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createCampaign', () => {
    it('should successfully create a campaign', async () => {
      vi.mocked(directusCrud.create).mockResolvedValueOnce({ id: 'new-camp-id' });
      
      const params = { name: 'Test Campaign', websiteUrl: 'https://test.com' };
      const result = await TOOL_IMPLEMENTATIONS.createCampaign(params, mockRequest);
      
      expect(result.success).toBe(true);
      expect(result.campaignId).toBe('new-camp-id');
      expect(directusCrud.create).toHaveBeenCalledWith('user_campaigns', expect.objectContaining({
        name: 'Test Campaign',
        user_id: 'user-1'
      }), expect.any(Object));
    });

    it('should block private IP addresses in websiteUrl', async () => {
      const params = { name: 'Evil', websiteUrl: 'http://127.0.0.1/secret' };
      const result = await TOOL_IMPLEMENTATIONS.createCampaign(params, mockRequest);
      expect(result.error).toContain('приватным IP адресам запрещен');
    });
  });

  describe('getCampaignData', () => {
    it('should return campaign and questionnaire', async () => {
      vi.mocked(directusCrud.list)
        .mockResolvedValueOnce([{ id: 'camp-1', name: 'My Campaign' }]) // campaign
        .mockResolvedValueOnce([{ id: 'q-1', company_name: 'Test Corp' }]); // questionnaire

      const result = await TOOL_IMPLEMENTATIONS.getCampaignData({ campaignId: 'camp-1' }, mockRequest);
      
      expect(result.data.campaign.name).toBe('My Campaign');
      expect(result.data.questionnaire.company_name).toBe('Test Corp');
      expect(result.data.hasQuestionnaire).toBe(true);
    });
  });

  describe('smartSearchTelegramChannels', () => {
    it('should search and add channels to sources', async () => {
      // 1. Mock keywords list
      vi.mocked(directusCrud.list).mockResolvedValueOnce([{ keyword: 'AI' }, { keyword: 'Tech' }]);
      
      // 2. Mock smart-search API call
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          channels: [{ title: 'AI News', username: 'ai_news' }],
          detectedCategory: { name_ru: 'Технологии' }
        }
      });

      // 3. Mock source creation
      vi.mocked(directusCrud.create).mockResolvedValueOnce({ id: 'src-1' });

      const params = { campaignId: 'camp-1', addToSources: true };
      const result = await TOOL_IMPLEMENTATIONS.smartSearchTelegramChannels(params, mockRequest);

      expect(result.success).toBe(true);
      expect(result.sourcesAdded).toHaveLength(1);
      expect(result.sourcesAdded[0].channel).toBe('AI News');
      expect(directusCrud.create).toHaveBeenCalledWith('campaign_content_sources', expect.any(Object), expect.any(Object));
    });
  });

  describe('webSearch', () => {
    it('should use fallback DuckDuckGo if Google keys missing', async () => {
      process.env.GOOGLE_SEARCH_API_KEY = '';
      
      // Mock axios.get for DuckDuckGo HTML with correct selectors
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: `
          <div class="result">
            <h2 class="result__title">AI News</h2>
            <a class="result__a" href="http://news.com">Link</a>
            <div class="result__snippet">Latest AI developments.</div>
          </div>
        `
      });

      const params = { query: 'latest AI news' };
      const result = await TOOL_IMPLEMENTATIONS.webSearch(params, mockRequest);

      expect(result.success).toBe(true);
      expect(result.resultsCount).toBe(1);
      expect(result.results[0].title).toBe('AI News');
    });
  });

  describe('createContent', () => {
    it('should generate content and save to database', async () => {
      // 1. Mock keywords
      vi.mocked(axios.get).mockResolvedValueOnce({ data: [{ keyword: 'AI' }] });
      
      // 2. Mock content generation
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { content: 'Generated Post Content' }
      });

      // 3. Mock save to database
      vi.mocked(directusCrud.create).mockResolvedValueOnce({ id: 'post-123' });

      const params = { campaignId: 'camp-1', topic: 'AI Future', count: 1 };
      const result = await TOOL_IMPLEMENTATIONS.createContent(params, mockRequest);

      expect(result.success).toBe(true);
      expect(result.count).toBe(1);
      expect(result.posts[0].id).toBe('post-123');
      expect(directusCrud.create).toHaveBeenCalledWith('campaign_content', expect.objectContaining({
        content: 'Generated Post Content'
      }), expect.any(Object));
    });
  });

  describe('generateImage', () => {
    it('should generate image via FAL API and attach to content if provided', async () => {
      // Mock FAL API response
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { images: [{ url: 'http://fal.ai/img.png' }] }
      });

      const params = { prompt: 'robot dancing', contentId: 'post-123' };
      const result = await TOOL_IMPLEMENTATIONS.generateImage(params, mockRequest);

      expect(result.success).toBe(true);
      expect(result.data.imageUrl).toBe('http://fal.ai/img.png');
      expect(directusCrud.updateItem).toHaveBeenCalledWith('campaign_content', 'post-123', expect.objectContaining({
        image_url: 'http://fal.ai/img.png'
      }), expect.any(Object));
    });
  });

  describe('rewriteContent', () => {
    it('should rewrite text using AI', async () => {
      vi.mocked(geminiDirect.generateContent).mockResolvedValueOnce('Shorter version');

      const params = { originalText: 'Long text', instructions: 'Make it shorter' };
      const result = await TOOL_IMPLEMENTATIONS.rewriteContent(params, mockRequest);

      expect(result.success).toBe(true);
      expect(result.data.rewritten).toBe('Shorter version');
    });
  });
});
