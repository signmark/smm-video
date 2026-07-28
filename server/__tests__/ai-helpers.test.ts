import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    cleanupExpiredCache,
    getCachedResults,
    getCachedKeywordsByUrl,
    mergeKeywords,
    extractFullSiteContent,
    searchCache,
    urlKeywordsCache,
    CACHE_DURATION
} from '../utils/ai-helpers';

vi.mock('axios');

// Загрузка сайта идёт через safeGet, а не через голый axios: адрес задаёт
// пользователь, и SSRF-проверка обязана быть и на этом запасном пути
// (находка ревью 2026-07-28). Мокаем именно эту границу.
const H = vi.hoisted(() => ({ safeGet: vi.fn() }));
vi.mock('../utils/safe-http', () => ({
    safeGet: H.safeGet,
    BlockedUrlError: class BlockedUrlError extends Error {},
}));

vi.mock('./logger', () => ({
    log: vi.fn()
}));

// Mock cheerio
vi.mock('cheerio', () => ({
    load: vi.fn().mockReturnValue({
        remove: vi.fn().mockReturnThis(),
        text: vi.fn().mockReturnValue('mocked clean text'),
        trim: vi.fn().mockReturnThis(),
    })
}));

describe('ai-helpers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        searchCache.clear();
        urlKeywordsCache.clear();
        vi.useFakeTimers();
    });

    describe('Cache Management', () => {
        it('should cleanup expired entries', () => {
            const now = Date.now();
            searchCache.set('old', { timestamp: now - CACHE_DURATION - 1000, results: [] });
            searchCache.set('new', { timestamp: now, results: [] });

            cleanupExpiredCache();

            expect(searchCache.has('old')).toBe(false);
            expect(searchCache.has('new')).toBe(true);
        });

        it('should get cached results correctly', () => {
            const results = [{ keyword: 'test' }];
            searchCache.set('test', { timestamp: Date.now(), results });

            expect(getCachedResults('test')).toEqual(results);
            expect(getCachedResults('nonexistent')).toBeNull();
        });

        it('should normalize and get cached results by URL', () => {
            const results = [{ keyword: 'url-test' }];
            urlKeywordsCache.set('http://example.com', { timestamp: Date.now(), results });

            expect(getCachedKeywordsByUrl('  HTTP://example.com  ')).toEqual(results);
        });
    });

    describe('mergeKeywords', () => {
        it('should merge and prioritize deepseek keywords', () => {
            const gemini = [{ keyword: 'common', trend: 50 }, { keyword: 'gemini-only', trend: 30 }];
            const deepseek = [{ keyword: 'common', trend: 100 }, { keyword: 'ds-only', trend: 70 }];

            const merged = mergeKeywords(gemini, deepseek);

            expect(merged.find(k => k.keyword === 'common').source).toBe('deepseek');
            expect(merged).toHaveLength(3);
            expect(merged[0].trend).toBeGreaterThanOrEqual(merged[1].trend);
        });
    });

    describe('extractFullSiteContent', () => {
        it('should extract content from a valid URL', async () => {
            H.safeGet.mockResolvedValue({
                status: 200,
                data: '<html><title>Test Page</title><body>Hello World</body></html>',
                headers: {}
            });

            const content = await extractFullSiteContent('http://test.com');

            expect(content).toContain('URL: http://test.com');
            expect(content).toContain('ЗАГОЛОВОК: Test Page');
            expect(H.safeGet).toHaveBeenCalledWith(expect.stringContaining('http://test.com'), expect.anything());
        });

        it('should handle axios errors gracefully', async () => {
            H.safeGet.mockRejectedValue(new Error('Network error'));

            const content = await extractFullSiteContent('http://fail.com');

            expect(content).toContain('Ошибка загрузки сайта: Network error');
        });

        it('should extract contacts (phones and emails)', async () => {
            H.safeGet.mockResolvedValue({
                status: 200,
                data: 'Contact us at +7 999 123-45-67 or support@mytest.ru',
                headers: {}
            });

            const content = await extractFullSiteContent('http://contacts.com');

            expect(content).toContain('ТЕЛЕФОНЫ: +7 999 123-45-67');
            expect(content).toContain('EMAIL: support@mytest.ru');
        });
    });
});
