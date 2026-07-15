import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/logger', () => ({ log: vi.fn() }));
vi.mock('axios', () => ({
  default: {
    get: vi.fn()
  }
}));

import axios from 'axios';
import { PublicationTracker } from '../services/publication-tracking';

describe('PublicationTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    process.env.DIRECTUS_URL = 'http://directus.test';
    process.env.DIRECTUS_TOKEN = 'test-token';
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('allows a recently queued pending post to be published', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: {
        data: {
          social_platforms: {
            telegram: {
              status: 'pending',
              updatedAt: new Date().toISOString()
            }
          }
        }
      }
    });

    const tracker = new PublicationTracker();

    await expect(tracker.canPublish('content-1', 'telegram')).resolves.toBe(true);
  });

  it('still blocks a platform that is already published', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: {
        data: {
          social_platforms: {
            telegram: {
              status: 'published',
              postUrl: 'https://t.me/channel/1'
            }
          }
        }
      }
    });

    const tracker = new PublicationTracker();

    await expect(tracker.canPublish('content-2', 'telegram')).resolves.toBe(false);
  });
});
