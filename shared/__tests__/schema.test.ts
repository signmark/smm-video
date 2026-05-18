/**
 * Unit tests for shared/schema.ts
 * Тестирует Zod схемы валидации
 */

import { describe, it, expect } from 'vitest';
import {
  insertBusinessQuestionnaireSchema,
  insertSupportMessageSchema,
  insertCampaignTrendTopicSchema,
} from '../schema';

describe('shared/schema', () => {
  describe('insertBusinessQuestionnaireSchema', () => {
    it('должен валидировать минимальные данные (campaign_id обязателен)', () => {
      const valid = { campaign_id: 'camp-123' };
      const result = insertBusinessQuestionnaireSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.campaign_id).toBe('camp-123');
      }
    });

    it('должен валидировать данные в snake_case', () => {
      const valid = {
        campaign_id: 'camp-123',
        business_name: 'Test Co',
        contact_info: 'contact@test.com',
        business_description: 'Description',
        target_audience: 'Audience',
      };
      const result = insertBusinessQuestionnaireSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.business_name).toBe('Test Co');
        expect(result.data.contact_info).toBe('contact@test.com');
      }
    });

    it('должен валидировать данные в camelCase', () => {
      const valid = {
        campaign_id: 'camp-123',
        companyName: 'Test Co',
        contactInfo: 'contact@test.com',
        businessDescription: 'Description',
        targetAudience: 'Audience',
      };
      const result = insertBusinessQuestionnaireSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.companyName).toBe('Test Co');
        expect(result.data.contactInfo).toBe('contact@test.com');
      }
    });

    it('должен отклонять отсутствие campaign_id', () => {
      const invalid = { business_name: 'Test' };
      const result = insertBusinessQuestionnaireSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('принимает пустой campaign_id (z.string() по умолчанию)', () => {
      const withEmpty = { campaign_id: '' };
      const result = insertBusinessQuestionnaireSchema.safeParse(withEmpty);
      expect(result.success).toBe(true);
    });

    it('должен принимать опциональный id', () => {
      const valid = { campaign_id: 'camp-123', id: 'q-001' };
      const result = insertBusinessQuestionnaireSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe('q-001');
      }
    });
  });

  describe('insertSupportMessageSchema', () => {
    it('должен валидировать валидное сообщение', () => {
      const valid = { message: 'Нужна помощь с кампанией' };
      const result = insertSupportMessageSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.message).toBe('Нужна помощь с кампанией');
      }
    });

    it('должен принимать опциональный userId', () => {
      const valid = { message: 'Test', userId: 'user-123' };
      const result = insertSupportMessageSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.userId).toBe('user-123');
      }
    });

    it('должен отклонять пустое сообщение', () => {
      const invalid = { message: '' };
      const result = insertSupportMessageSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('должен отклонять отсутствие сообщения', () => {
      const invalid = {};
      const result = insertSupportMessageSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe('insertCampaignTrendTopicSchema', () => {
    it('должен валидировать минимальные данные', () => {
      const valid = { title: 'Trend 1', campaignId: 'camp-123', sourceId: null };
      const result = insertCampaignTrendTopicSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.title).toBe('Trend 1');
        expect(result.data.campaignId).toBe('camp-123');
        expect(result.data.reactions).toBe(0);
        expect(result.data.comments).toBe(0);
        expect(result.data.views).toBe(0);
        expect(result.data.isBookmarked).toBe(false);
      }
    });

    it('должен применять defaults для опциональных полей', () => {
      const valid = { title: 'T', campaignId: 'c', sourceId: 's-1' };
      const result = insertCampaignTrendTopicSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.reactions).toBe(0);
        expect(result.data.comments).toBe(0);
        expect(result.data.views).toBe(0);
        expect(result.data.isBookmarked).toBe(false);
      }
    });

    it('должен принимать кастомные значения', () => {
      const valid = {
        title: 'Viral',
        campaignId: 'camp-1',
        sourceId: 'src-1',
        reactions: 100,
        comments: 50,
        views: 1000,
        isBookmarked: true,
      };
      const result = insertCampaignTrendTopicSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.reactions).toBe(100);
        expect(result.data.comments).toBe(50);
        expect(result.data.views).toBe(1000);
        expect(result.data.isBookmarked).toBe(true);
      }
    });

    it('должен отклонять отсутствие title', () => {
      const invalid = { campaignId: 'camp-123' };
      const result = insertCampaignTrendTopicSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('должен отклонять отсутствие campaignId', () => {
      const invalid = { title: 'Trend' };
      const result = insertCampaignTrendTopicSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });
});
