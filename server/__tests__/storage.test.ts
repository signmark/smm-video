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

    describe('getScheduledContent', () => {
        it('requests canonical and legacy partial statuses', async () => {
            (directusApi.get as any).mockResolvedValue({
                data: {
                    data: [{
                        id: 'content-1',
                        user_id: 'user-123',
                        campaign_id: 'campaign-1',
                        status: 'partially_published',
                        content_type: 'text',
                        content: 'Post',
                        scheduled_at: '2026-07-20T10:00:00.000Z',
                        created_at: '2026-07-20T09:00:00.000Z',
                    }],
                },
            });

            const result = await storage.getScheduledContent('user-123');

            expect(directusApi.get).toHaveBeenCalledWith(
                '/items/campaign_content',
                expect.objectContaining({
                    params: expect.objectContaining({
                        filter: expect.objectContaining({
                            status: {
                                _in: ['scheduled', 'partial', 'partially_published'],
                            },
                        }),
                    }),
                }),
            );
            expect(result).toHaveLength(1);
            expect(result[0].status).toBe('partially_published');
        });
    });

    describe('updateCampaignContent', () => {
        it('persists and returns the aggregate publication timestamp', async () => {
            const publishedAt = new Date('2026-07-17T10:15:00.000Z');
            (directusApi.patch as any).mockResolvedValue({
                status: 200,
                data: {
                    data: {
                        id: 'content-1',
                        user_id: 'user-123',
                        campaign_id: 'campaign-1',
                        status: 'published',
                        content_type: 'text',
                        content: 'Post',
                        created_at: '2026-07-17T09:00:00.000Z',
                        published_at: publishedAt.toISOString(),
                        social_platforms: {
                            telegram: {
                                status: 'published',
                                publishedAt: publishedAt.toISOString(),
                            },
                        },
                    },
                },
            });

            const result = await storage.updateCampaignContent('content-1', {
                status: 'published',
                publishedAt,
            }, 'test-auth-token');

            expect(directusApi.patch).toHaveBeenCalledWith(
                '/items/campaign_content/content-1',
                expect.objectContaining({
                    status: 'published',
                    published_at: publishedAt.toISOString(),
                }),
                expect.any(Object),
            );
            expect(result.publishedAt).toEqual(publishedAt);
        });
    });
});
