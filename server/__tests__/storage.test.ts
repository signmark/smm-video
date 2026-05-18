import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatabaseStorage } from '../storage';
import { directusApi } from '../lib/directus';

vi.mock('../lib/directus', () => ({
    directusApi: {
        get: vi.fn(),
        post: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
        create: vi.fn().mockReturnValue({
            interceptors: {
                response: { use: vi.fn() }
            }
        })
    },
    DIRECTUS_URL: 'http://mock-directus'
}));

describe('DatabaseStorage', () => {
    let storage: DatabaseStorage;

    beforeEach(() => {
        vi.clearAllMocks();
        storage = new DatabaseStorage();
        process.env.DIRECTUS_SERVICE_TOKEN = 'mock-service-token';
    });

    describe('getUserTokenInfo', () => {
        it('should return service token from env if available', async () => {
            const info = await storage.getUserTokenInfo('user-123');
            expect(info).toEqual({
                token: 'mock-service-token',
                userId: 'user-123'
            });
        });

        it('should return null if no token is available', async () => {
            delete process.env.DIRECTUS_SERVICE_TOKEN;
            const info = await storage.getUserTokenInfo('user-123');
            expect(info).toBeNull();
        });
    });

    describe('getContentSources', () => {
        it('should return content sources for a user', async () => {
            const mockResult = {
                data: {
                    data: [
                        { id: 1, name: 'Source 1', url: 'url1', type: 'tg', is_active: true, user_id: 'user-123' }
                    ]
                }
            };
            (directusApi.get as any).mockResolvedValue(mockResult);

            const sources = await storage.getContentSources('user-123');

            expect(directusApi.get).toHaveBeenCalledWith('/items/content_sources', expect.objectContaining({
                headers: { Authorization: 'Bearer mock-service-token' }
            }));
            expect(sources).toHaveLength(1);
            expect(sources[0].name).toBe('Source 1');
        });

        it('should handle empty response or errors', async () => {
            (directusApi.get as any).mockRejectedValue(new Error('API error'));
            const sources = await storage.getContentSources('user-123');
            expect(sources).toEqual([]);
        });
    });

    describe('getCampaigns', () => {
        it('should fetch user campaigns', async () => {
            const mockCampaigns = {
                data: {
                    data: [
                        { id: 10, name: 'Campaign 1', description: 'Desc', user_id: 'user-123' }
                    ]
                }
            };
            (directusApi.get as any).mockResolvedValue(mockCampaigns);

            const campaigns = await storage.getCampaigns('user-123');

            expect(directusApi.get).toHaveBeenCalledWith('/items/user_campaigns', expect.objectContaining({
                params: { filter: { user_id: { _eq: 'user-123' } } }
            }));
            expect(campaigns).toHaveLength(1);
            expect(campaigns[0].id).toBe(10);
        });
    });
});
