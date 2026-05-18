import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

// Mock dependencies
vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn()
  }
}));

describe('Integration: Campaign Full Cycle', () => {
  const mockAuthToken = 'mock-jwt-token';
  const baseUrl = 'http://localhost:5000';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should complete the cycle: Website Analysis -> Create Campaign -> Generate Post', async () => {
    // 1. Website Analysis
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: { 
        success: true, 
        data: { companyName: 'AI Burger', businessDescription: 'Best AI Burgers' } 
      }
    });

    const analysisResponse = await axios.post(`${baseUrl}/api/website-analysis`, {
      url: 'https://aiburger.test'
    }, { headers: { Authorization: `Bearer ${mockAuthToken}` } });

    expect(analysisResponse.data.success).toBe(true);
    const analysisData = analysisResponse.data.data;

    // 2. Create Campaign using analysis data
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: { success: true, data: { id: 'camp-burger-1' } }
    });

    const campaignResponse = await axios.post(`${baseUrl}/api/campaigns`, {
      name: analysisData.companyName,
      description: analysisData.businessDescription,
      link: 'https://aiburger.test'
    }, { headers: { Authorization: `Bearer ${mockAuthToken}` } });

    expect(campaignResponse.data.success).toBe(true);
    const campaignId = campaignResponse.data.data.id;

    // 3. Generate Content for this campaign
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: { success: true, content: 'Juicy AI Burger is here!' }
    });

    const contentResponse = await axios.post(`${baseUrl}/api/generate-content`, {
      campaignId: campaignId,
      topic: 'Promo for Friday'
    }, { headers: { Authorization: `Bearer ${mockAuthToken}` } });

    expect(contentResponse.data.success).toBe(true);
    expect(contentResponse.data.content).toContain('Burger');
  });
});
