import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseSocialService } from '../services/social/base-service';
import { storage } from '../storage';
import { CampaignContent, SocialPlatform } from '@shared/schema';

// Concrete implementation for testing
class TestSocialService extends BaseSocialService {
    async publishToPlatform() {
        return { platform: 'facebook' as SocialPlatform, status: 'published' };
    }
}

vi.mock('../storage', () => ({
    storage: {
        getCampaignContentById: vi.fn(),
        updateCampaignContent: vi.fn()
    }
}));

vi.mock('../../utils/logger');
vi.mock('../beget-s3-storage-aws');
vi.mock('fs');

describe('BaseSocialService', () => {
    let service: TestSocialService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new TestSocialService();
    });

    describe('processAdditionalImages', () => {
        it('should handle missing additionalImages', () => {
            const content: CampaignContent = { id: '1', campaign_id: 'c1', content: 'test' };
            const result = service['processAdditionalImages'](content, 'test');
            expect(result.additionalImages).toEqual([]);
        });

        it('should parse JSON string in additionalImages', () => {
            const content: CampaignContent = {
                id: '1',
                campaign_id: 'c1',
                content: 'test',
                additionalImages: JSON.stringify(['url1', 'url2'])
            };
            const result = service['processAdditionalImages'](content, 'test');
            expect(result.additionalImages).toEqual(['url1', 'url2']);
        });

        it('should handle single URL string in additionalImages', () => {
            const content: CampaignContent = {
                id: '1',
                campaign_id: 'c1',
                content: 'test',
                additionalImages: 'http://example.com/img.jpg'
            };
            const result = service['processAdditionalImages'](content, 'test');
            expect(result.additionalImages).toEqual(['http://example.com/img.jpg']);
        });
    });

    describe('updatePublicationStatus', () => {
        it('should update status and merge platform data', async () => {
            const contentId = 'content-1';
            const mockContent = {
                id: contentId,
                socialPlatforms: {
                    instagram: { status: 'published' }
                }
            };

            (storage.getCampaignContentById as any).mockResolvedValue(mockContent as any);
            (storage.updateCampaignContent as any).mockResolvedValue({ ...mockContent, socialPlatforms: { ...mockContent.socialPlatforms, facebook: { status: 'published' } } } as any);

            // Mock getSystemToken
            vi.spyOn(service as any, 'getSystemToken').mockResolvedValue('token');

            const result = await service.updatePublicationStatus(contentId, 'facebook' as SocialPlatform, {
                status: 'published',
                postUrl: 'htt://fb.com/post'
            });

            expect(storage.updateCampaignContent).toHaveBeenCalledWith(
                contentId,
                expect.objectContaining({
                    socialPlatforms: expect.objectContaining({
                        instagram: { status: 'published' },
                        facebook: expect.objectContaining({ status: 'published', postUrl: 'htt://fb.com/post' })
                    })
                }),
                'token'
            );
        });
    });
});
