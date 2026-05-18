/**
 * Unit tests for shared/stories-schema.ts
 * Тестирует Zod схемы Stories
 */

import { describe, it, expect } from 'vitest';
import {
  insertStoryContentSchema,
  insertStorySlideSchema,
  insertStoryElementSchema,
} from '../stories-schema';

const validCampaignId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const validUserId = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const validStoryId = 'c3d4e5f6-a7b8-9012-cdef-123456789012';
const validSlideId = 'd4e5f6a7-b8c9-0123-defa-234567890123';

describe('shared/stories-schema', () => {
  describe('insertStoryContentSchema', () => {
    it('должен валидировать минимальный контент story', () => {
      const valid = {
        campaignId: validCampaignId,
        userId: validUserId,
        title: 'My Story',
        type: 'story' as const,
      };
      const result = insertStoryContentSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('draft');
        expect(result.data.type).toBe('story');
      }
    });

    it('должен применять default для type и status', () => {
      const valid = {
        campaignId: validCampaignId,
        userId: validUserId,
        title: 'Test',
      };
      const result = insertStoryContentSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('story');
        expect(result.data.status).toBe('draft');
      }
    });

    it('должен принимать все статусы', () => {
      const statuses = ['draft', 'scheduled', 'published', 'failed'] as const;
      statuses.forEach((status) => {
        const valid = {
          campaignId: validCampaignId,
          userId: validUserId,
          title: 'T',
          status,
        };
        const result = insertStoryContentSchema.safeParse(valid);
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.status).toBe(status);
      });
    });

    it('должен отклонять невалидный campaignId (не UUID)', () => {
      const invalid = {
        campaignId: 'not-uuid',
        userId: validUserId,
        title: 'T',
      };
      const result = insertStoryContentSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('принимает пустой title (z.string() по умолчанию)', () => {
      const withEmpty = {
        campaignId: validCampaignId,
        userId: validUserId,
        title: '',
      };
      const result = insertStoryContentSchema.safeParse(withEmpty);
      expect(result.success).toBe(true);
    });
  });

  describe('insertStorySlideSchema', () => {
    it('должен валидировать минимальный slide', () => {
      const valid = {
        storyId: validStoryId,
        order: 0,
        background: { type: 'color' as const, value: '#fff' },
      };
      const result = insertStorySlideSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.duration).toBe(5);
      }
    });

    it('должен принимать duration от 1 до 15', () => {
      for (let d = 1; d <= 15; d++) {
        const valid = {
          storyId: validStoryId,
          order: 0,
          duration: d,
          background: { type: 'color' as const, value: '#000' },
        };
        const result = insertStorySlideSchema.safeParse(valid);
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.duration).toBe(d);
      }
    });

    it('должен отклонять duration < 1', () => {
      const invalid = {
        storyId: validStoryId,
        order: 0,
        duration: 0,
        background: {},
      };
      const result = insertStorySlideSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('должен отклонять duration > 15', () => {
      const invalid = {
        storyId: validStoryId,
        order: 0,
        duration: 16,
        background: {},
      };
      const result = insertStorySlideSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe('insertStoryElementSchema', () => {
    it('должен валидировать минимальный element', () => {
      const valid = {
        slideId: validSlideId,
        type: 'text',
        position: { x: 0, y: 0, width: 100, height: 50 },
        content: 'Hello',
      };
      const result = insertStoryElementSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.rotation).toBe('0');
        expect(result.data.zIndex).toBe(1);
      }
    });

    it('должен применять defaults', () => {
      const valid = { slideId: validSlideId, type: 'image', position: {}, content: {} };
      const result = insertStoryElementSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.rotation).toBe('0');
        expect(result.data.zIndex).toBe(1);
      }
    });
  });
});
