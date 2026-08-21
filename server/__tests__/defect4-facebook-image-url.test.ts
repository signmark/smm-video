/**
 * AI-38 task #71 defect 4: facebook webhook passes imageUrl to publishToFacebook.
 *
 * Behavioral test: the webhook constructs a CampaignContent object and passes it
 * to facebookService.publishToFacebook. The service reads content.imageUrl in
 * multiple places (including Cloudinary proxy). This test verifies the field is
 * present under the correct camelCase name.
 *
 * Mutation: rename imageUrl to image_url in the webhook → this test goes RED.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// --- Mocks (hoisted) ---
const H = vi.hoisted(() => ({
  publishToFacebook: vi.fn(async () => ({ status: 'published', postUrl: 'https://fb.com/post/1', postId: 'fb-1' })),
  updatePublicationStatus: vi.fn(async () => ({})),
  resolvePlatformToken: vi.fn(async () => ({ token: 'fb-token', pageId: 'fb-page-1' })),
  directusGet: vi.fn(async () => ({
    data: {
      data: {
        id: 'content-1',
        campaign_id: 'camp-1',
        user_id: 'user-1',
        content: 'Test post text',
        image_url: 'https://example.com/photo.jpg',
        content_type: 'text',
        title: 'Test title',
        social_platforms: { facebook: { selected: true } },
        status: 'draft',
        scheduled_at: null,
        published_at: null,
        created_at: new Date().toISOString(),
      },
    },
  })),
  directusPatch: vi.fn(async () => ({ data: { data: {} } })),
}));

vi.mock('../services/social-platforms/facebook-service', () => ({
  facebookService: { publishToFacebook: H.publishToFacebook, updatePublicationStatus: H.updatePublicationStatus },
}));

vi.mock('../services/campaign-token-resolver', () => ({
  resolvePlatformToken: H.resolvePlatformToken,
}));

vi.mock('../services/directus-auth-manager', () => ({
  directusAuthManager: {
    getAllActiveSessions: vi.fn(() => []),
    getAdminAuthToken: vi.fn(async () => 'admin-token'),
  },
}));

vi.mock('../middleware/user-auth', () => ({
  authenticateUser: (_req: any, _res: any, next: any) => {
    _req.user = { id: 'user-1', token: 'user-token' };
    next();
  },
}));

vi.mock('../services/campaign-access', () => ({
  authorizeCampaignAccess: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../services/content-access', () => ({
  assertContentBelongsToRequester: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../middleware/webhook-auth', () => ({
  requireWebhookSecret: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('axios', () => {
  const instance = {
    get: vi.fn(async (url: string) => {
      if (url.includes('campaign_content')) {
        return {
          data: {
            data: {
              id: 'content-1',
              campaign_id: 'camp-1',
              user_id: 'user-1',
              content: 'Test post text',
              image_url: 'https://example.com/photo.jpg',
              content_type: 'text',
              title: 'Test title',
              social_platforms: { facebook: { selected: true } },
              status: 'draft',
              scheduled_at: null,
              published_at: null,
              created_at: new Date().toISOString(),
            },
          },
        };
      }
      if (url.includes('user_campaigns')) {
        return {
          data: {
            data: {
              id: 'camp-1',
              name: 'Test campaign',
              social_media_settings: {
                facebook: { token: 'fb-token', pageId: 'fb-page-1' },
              },
            },
          },
        };
      }
      return { data: { data: null } };
    }),
    patch: H.directusPatch,
    post: vi.fn(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  };
  return {
    default: { get: instance.get, patch: H.directusPatch, post: vi.fn(), create: () => instance },
    create: () => instance,
  };
});

vi.mock('../utils/logger', () => {
  const log: any = vi.fn();
  log.debug = vi.fn();
  log.info = vi.fn();
  log.warn = vi.fn();
  log.error = vi.fn();
  return { log, default: log, logEvent: vi.fn() };
});

import facebookWebhookRouter from '../api/facebook-webhook-unified';

const app = express();
app.use(express.json());
app.use('/', facebookWebhookRouter);

describe('defect 4: facebook webhook passes imageUrl to service', () => {
  beforeEach(() => {
    H.publishToFacebook.mockClear();
  });

  it('publishToFacebook receives content with imageUrl (camelCase) for image posts', async () => {
    const res = await request(app)
      .post('/')
      .send({
        contentId: 'content-1',
        facebookAccessToken: 'fb-token',
        facebookPageId: 'fb-page-1',
      });

    // The webhook should have called publishToFacebook
    expect(H.publishToFacebook).toHaveBeenCalledTimes(1);

    const callArgs = H.publishToFacebook.mock.calls[0] as unknown[];
    const passedContent = callArgs[0] as Record<string, unknown>;

    // Critical: imageUrl must be present (camelCase) — the service reads it in 4 places
    expect(passedContent.imageUrl).toBe('https://example.com/photo.jpg');

    // Must NOT have author or links (not in CampaignContent type)
    expect(passedContent).not.toHaveProperty('author');
    expect(passedContent).not.toHaveProperty('links');
  });
});
