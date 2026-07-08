import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies BEFORE importing the service
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
    default: Object.assign(vi.fn().mockResolvedValue({ data: {} }), {
      create: vi.fn().mockReturnValue(instance),
      get: vi.fn().mockResolvedValue({ data: {} }),
      post: vi.fn().mockResolvedValue({ data: {} }),
    }),
  };
});

vi.mock('../directus-crud', () => ({
  directusCrud: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    getById: vi.fn()
  }
}));

vi.mock('../gemini-direct', () => ({
  geminiDirect: {
    generateContent: vi.fn()
  }
}));

vi.mock('../autonomous-ai', () => {
  return {
    AutonomousAI: vi.fn().mockImplementation(() => ({
      processCommand: vi.fn()
    }))
  };
});

import { 
  executeStepwiseWorkflow, 
  adaptAPICallWithContext, 
  handleStepError,
  shouldUseAutonomousAI,
  getActionName,
  getSuccessMessage
} from '../services/ai-assistant/autonomous';
import axios from 'axios';

describe('AI Assistant Autonomous Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('executeStepwiseWorkflow', () => {
    it('should return immediate response if no api_calls', async () => {
      const aiPlan = { user_response: 'Hello', api_calls: [] };
      const request: any = {};
      
      const result = await executeStepwiseWorkflow(aiPlan, request);
      
      expect(result.success).toBe(true);
      expect(result.response).toBe('Hello');
    });

    it('should execute API calls and build context', async () => {
      const aiPlan = {
        api_calls: [
          { method: 'POST', endpoint: '/api/website-analysis', body: { url: 'http://test.com' } },
          { method: 'POST', endpoint: '/api/campaigns' }
        ]
      };
      const request = { authToken: 'tk123' } as any;

      // Mock axios for internal API calls
      vi.mocked(axios).mockResolvedValueOnce({ data: { success: true, data: { companyName: 'Test Corp' } } });
      vi.mocked(axios).mockResolvedValueOnce({ data: { success: true, data: { id: 'new-camp-id' } } });

      const result = await executeStepwiseWorkflow(aiPlan, request);

      expect(result.success).toBe(true);
      expect(result.data.step_results).toHaveLength(2);
      expect(result.data.workflow_context.websiteAnalysis.companyName).toBe('Test Corp');
      expect(result.data.workflow_context.newCampaign.id).toBe('new-camp-id');
    });
  });

  describe('adaptAPICallWithContext', () => {
    it('should replace {NEW_CAMPAIGN_ID} placeholders', async () => {
      const apiCall = { endpoint: '/api/campaigns/{NEW_CAMPAIGN_ID}/questionnaire', body: { campaignId: '{NEW_CAMPAIGN_ID}' } };
      const context = { step_2_data: { id: 'real-id' } };
      
      const adapted = await adaptAPICallWithContext(apiCall, context, {} as any);
      
      expect(adapted.endpoint).toBe('/api/campaigns/real-id/questionnaire');
      expect(adapted.body.campaignId).toBe('real-id');
    });

    it('should adapt campaign creation with website analysis results', async () => {
      const apiCall = { method: 'POST', endpoint: '/api/campaigns', body: {} };
      const context = { 
        websiteAnalysis: { companyName: 'Magnus Tech', businessDescription: 'AI Dev', targetAudience: 'Devs' },
        websiteUrl: 'http://magnus.ai'
      };

      const adapted = await adaptAPICallWithContext(apiCall, context, {} as any);

      expect(adapted.body.description).toContain('Magnus Tech');
      expect(adapted.body.link).toBe('http://magnus.ai');
    });
  });

  describe('handleStepError', () => {
    it('should retry questionnaire PATCH with POST on 404', async () => {
      const apiCall = { method: 'PATCH', endpoint: '/api/campaigns/1/questionnaire' };
      const result = { status: 404, error: 'Not found' };
      const request = { authToken: 'tk' } as any;

      vi.mocked(axios).mockResolvedValueOnce({ data: { success: true, data: { id: 'created' } } });

      const retryResult = await handleStepError(apiCall, result, {}, request);

      expect(retryResult.success).toBe(true);
      expect(axios).toHaveBeenCalledWith(expect.objectContaining({ method: 'post' }));
    });

    it('should retry questionnaire POST with PATCH on 400', async () => {
      const apiCall = { method: 'POST', endpoint: '/api/campaigns/1/questionnaire' };
      const result = { status: 400, error: 'Already exists' };
      const request = { authToken: 'tk' } as any;

      vi.mocked(axios).mockResolvedValueOnce({ data: { success: true, data: { id: 'updated' } } });

      const retryResult = await handleStepError(apiCall, result, {}, request);

      expect(retryResult.success).toBe(true);
      expect(axios).toHaveBeenCalledWith(expect.objectContaining({ method: 'patch' }));
    });

    it('should return failure if no retry logic matches', async () => {
      const apiCall = { method: 'GET', endpoint: '/api/unknown' };
      const result = { status: 500, error: 'Server Error' };

      const retryResult = await handleStepError(apiCall, result, {}, {} as any);

      expect(retryResult.success).toBe(false);
      expect(retryResult.error).toBe('Server Error');
    });
  });

  describe('shouldUseAutonomousAI', () => {
    it('should return true for complex keywords', () => {
      expect(shouldUseAutonomousAI('собери тренды')).toBe(true);
      expect(shouldUseAutonomousAI('проанализируй сайт http://test.com')).toBe(true);
      expect(shouldUseAutonomousAI('умно реши сам')).toBe(true);
    });

    it('should return false for simple commands', () => {
      expect(shouldUseAutonomousAI('привет')).toBe(false);
      expect(shouldUseAutonomousAI('создай пост')).toBe(false);
    });
  });

  describe('Helper logic', () => {
    it('getActionName should map keys correctly', () => {
      expect(getActionName('getKeywords')).toBe('Анализ ключевых слов');
      expect(getActionName('unknown')).toBe('unknown');
    });

    it('getSuccessMessage should format different actions', () => {
      expect(getSuccessMessage('getCampaignData', { name: 'SMM' })).toContain('SMM');
      expect(getSuccessMessage('getKeywords', { keywords: [1, 2] })).toContain('2');
    });
  });
});
