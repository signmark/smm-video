import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { aiService } from '../services/ai-service';
import { globalApiKeysService } from '../services/global-api-keys';
import { apiKeyService } from '../services/api-keys';
import { directusApi } from '../directus';

vi.mock('axios');
vi.mock('../services/global-api-keys', () => ({
    globalApiKeysService: {
        getGlobalApiKey: vi.fn()
    }
}));
vi.mock('../services/api-keys', () => ({
    apiKeyService: {
        getApiKey: vi.fn()
    },
    ApiServiceName: {
        DEEPSEEK: 'deepseek',
        GEMINI: 'gemini',
        QWEN: 'qwen'
    }
}));
vi.mock('../utils/logger', () => ({
    log: Object.assign(vi.fn(), { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    DEBUG_LEVELS: {}
}));
vi.mock('../directus', () => ({
    directusApi: {
        get: vi.fn(),
        post: vi.fn()
    }
}));
vi.mock('../services/web-crawler-agent', () => ({
    webCrawlerAgent: {
        crawlSite: vi.fn()
    }
}));
vi.mock('../services/gemini-proxy', () => ({
    geminiProxyService: {
        setApiKey: vi.fn(),
        testApiKey: vi.fn()
    }
}));
vi.mock('../utils/ai-helpers', () => ({
    extractFullSiteContent: vi.fn()
}));

describe('AiService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.restoreAllMocks();
    });

    describe('generateContent', () => {
        it('should route to DeepSeek when service is deepseek', async () => {
            const spy = vi.spyOn(aiService, 'generateWithDeepSeek').mockResolvedValue({
                success: true,
                content: 'deepseek result'
            });

            const result = await aiService.generateContent({
                prompt: 'test',
                service: 'deepseek'
            });

            expect(spy).toHaveBeenCalled();
            expect(result.content).toBe('deepseek result');
            spy.mockRestore();
        });

        it('should default to Gemini when service is unknown', async () => {
            const spy = vi.spyOn(aiService, 'generateWithGemini').mockResolvedValue({
                success: true,
                content: 'gemini result'
            });

            const result = await aiService.generateContent({
                prompt: 'test',
                service: 'unknown'
            });

            expect(spy).toHaveBeenCalled();
            expect(result.content).toBe('gemini result');
            spy.mockRestore();
        });
    });

    describe('generateWithDeepSeek', () => {
        it('should generate content via DeepSeek API', async () => {
            (globalApiKeysService.getGlobalApiKey as any).mockResolvedValue('mock-api-key');
            (axios.post as any).mockResolvedValue({
                data: {
                    choices: [{ message: { content: 'mocked content' } }]
                }
            });

            const result = await aiService.generateWithDeepSeek({
                prompt: 'hello',
                systemPrompt: 'be nice'
            });

            expect(axios.post).toHaveBeenCalledWith(
                'https://api.deepseek.com/v1/chat/completions',
                expect.objectContaining({
                    messages: [
                        { role: 'system', content: 'be nice' },
                        { role: 'user', content: 'hello' }
                    ]
                }),
                expect.anything()
            );
            expect(result.content).toBe('mocked content');
        });

        it('should throw error if API key is missing', async () => {
            (globalApiKeysService.getGlobalApiKey as any).mockResolvedValue(null);
            (apiKeyService.getApiKey as any).mockResolvedValue(null);

            await expect(aiService.generateWithDeepSeek({ prompt: 'test' }))
                .rejects.toThrow('API ключ DeepSeek не найден.');
        });
    });

    describe('validateApiKeys', () => {
        it('should validate Gemini and DeepSeek keys', async () => {
            const { geminiProxyService } = await import('../services/gemini-proxy');
            (globalApiKeysService.getGlobalApiKey as any).mockResolvedValue('key');
            (geminiProxyService.testApiKey as any).mockResolvedValue(true);
            (axios.get as any).mockResolvedValue({ status: 200 });

            const results = await aiService.validateApiKeys();

            expect(results.gemini.valid).toBe(true);
            expect(results.deepseek.valid).toBe(true);
        });

        it('should handle missing keys', async () => {
            (globalApiKeysService.getGlobalApiKey as any).mockResolvedValue(null);
            const results = await aiService.validateApiKeys();
            expect(results.gemini.valid).toBe(false);
            expect(results.deepseek.valid).toBe(false);
        });
    });

    describe('analyzeWebsiteKeywords', () => {
        const LONG_CONTENT = 'This is a long enough content to satisfy the 50 characters requirement of the service logic for testing purposes.';

        it('should crawl site and save keywords', async () => {
            const { webCrawlerAgent } = await import('../services/web-crawler-agent');
            (webCrawlerAgent.crawlSite as any).mockResolvedValue({ success: true, text: LONG_CONTENT });

            const generateSpy = vi.spyOn(aiService, 'generateContent').mockResolvedValue({
                content: '[{"keyword": "test", "trend": 100, "competition": 50}]'
            });

            const keywords = await aiService.analyzeWebsiteKeywords('http://test.com', 'camp-123', 'token-456');

            expect(keywords).toHaveLength(1);
            expect(keywords[0].keyword).toBe('test');
            expect(directusApi.post).toHaveBeenCalledWith('/items/campaign_keywords', expect.anything(), expect.anything());
            generateSpy.mockRestore();
        });

        it('should fallback to axios if crawler fails', async () => {
            const { webCrawlerAgent } = await import('../services/web-crawler-agent');
            const { extractFullSiteContent } = await import('../utils/ai-helpers');

            (webCrawlerAgent.crawlSite as any).mockResolvedValue({ success: false, error: 'fail' });
            (extractFullSiteContent as any).mockResolvedValue(LONG_CONTENT);

            const generateSpy = vi.spyOn(aiService, 'generateContent').mockResolvedValue({
                content: '[{"keyword": "test"}]'
            });

            await aiService.analyzeWebsiteKeywords('http://test.com');
            expect(extractFullSiteContent).toHaveBeenCalled();
            generateSpy.mockRestore();
        });
    });
});
