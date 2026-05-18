import { describe, it, expect, beforeAll, vi } from 'vitest';
import axios from 'axios';

// Размокируем axios для реальных запросов
vi.unmock('axios');

// Используем порт 5000 для тестов (согласно ТЗ)
const API_URL = 'http://127.0.0.1:5000';
const DIRECTUS_ADMIN_TOKEN = process.env.DIRECTUS_ADMIN_TOKEN || '9d3ntQvqb1xTryzpw8-d1bi4ZpkHDigv';

describe('Story Flow Integration Test', () => {
  const authToken = DIRECTUS_ADMIN_TOKEN;
  let testContentId: string;
  let testCampaignId: string;

  beforeAll(async () => {
    vi.setConfig({ testTimeout: 60000 });
    
    // Получаем или создаем кампанию
    try {
      const campResponse = await axios.get(`${API_URL}/api/campaigns`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (campResponse.data.data && campResponse.data.data.length > 0) {
        testCampaignId = campResponse.data.data[0].id;
      } else {
        const createCamp = await axios.post(`${API_URL}/api/campaigns`, {
          name: 'Story Test Campaign',
          description: 'Campaign for testing story flow'
        }, {
          headers: { 'Authorization': `Bearer ${authToken}` }
        });
        testCampaignId = createCamp.data.data.id;
      }
      
      // Создаем тестовую сторис
      const storyResponse = await axios.post(`${API_URL}/api/stories/simple`, {
        campaignId: testCampaignId,
        title: 'Test Story for Flow'
      }, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      testContentId = storyResponse.data.data.id;
      console.log(`Created test story: ${testContentId} in campaign: ${testCampaignId}`);
    } catch (error: any) {
      console.error("Setup failed:", error.response?.data || error.message);
      // Если сервер не запущен, тест упадет дальше, что и требуется для проверки ERR_CONNECTION_REFUSED
    }
  });

  it('Should successfully publish a story (POST /api/stories/publish)', async () => {
    try {
      const response = await axios.post(`${API_URL}/api/stories/publish`, {
        contentId: testContentId,
        platforms: ['instagram'],
        useGeneratedImage: false
      }, {
        headers: { 
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      console.log("PUBLISH_RESPONSE:", JSON.stringify(response.data, null, 2));
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
    } catch (error: any) {
      console.error("PUBLISH_ERROR:", error.response?.data || error.message);
      throw error;
    }
  });

  it('Should not crash the server on invalid publish request', async () => {
    try {
      const response = await axios.post(`${API_URL}/api/stories/publish`, {
        contentId: 'invalid-id',
        platforms: ['instagram']
      }, {
        headers: { 
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        validateStatus: () => true
      });
      
      expect([404, 500]).toContain(response.status);
      expect(response.data.error).toBeDefined();
    } catch (error: any) {
      console.error("INVALID_PUBLISH_ERROR:", error.message);
      throw error;
    }
  });
});
