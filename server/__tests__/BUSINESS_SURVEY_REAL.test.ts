
import { describe, it, expect, beforeAll, vi } from 'vitest';
import axios from 'axios';

// Размокируем axios для реальных запросов
vi.unmock('axios');

// Используем порт 5000 для тестов (согласно ТЗ)
const API_URL = 'http://127.0.0.1:5000';
const DIRECTUS_ADMIN_TOKEN = process.env.DIRECTUS_ADMIN_TOKEN || 'iXK-O-CM2qie9XALrnVfrAgEq0yviBe6';

describe('Business Questionnaire Real Integration Test', () => {
  const authToken = DIRECTUS_ADMIN_TOKEN;
  let testCampaignId: string;

  const requiredFields = [
    'companyName',
    'contactInfo',
    'businessDescription',
    'mainActivities',
    'brandImage',
    'productsServices',
    'targetAudience',
    'customerResults',
    'companyFeatures',
    'businessValues',
    'productBeliefs',
    'competitiveAdvantages',
    'marketingExpectations'
  ];

  beforeAll(async () => {
    vi.setConfig({ testTimeout: 150000 });

    // Создаем тестовую кампанию для чистоты теста
    try {
      const response = await axios.post(`${API_URL}/api/campaigns`, {
        name: 'Integration Test Campaign',
        description: 'Temporary campaign for testing'
      }, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });
      testCampaignId = response.data.data.id;
      console.log(`Created test campaign: ${testCampaignId}`);
    } catch (error: any) {
      console.error("Failed to create test campaign:", error.response?.data || error.message);
      testCampaignId = '03603753-4e68-4f52-86fe-230920583eaf';
    }
  });

  it('1. Create/Update record in business_questionnaire', async () => {
    const questionnaireData = {
      companyName: 'Test AI Company',
      businessDescription: 'We provide advanced AI solutions for businesses.',
      mainActivities: 'AI Software Development',
      brandImage: 'Professional and Innovative',
      campaignId: testCampaignId,
      contactInfo: 'test@example.com',
      productsServices: 'AI Chatbots, Analytics',
      targetAudience: 'Small businesses',
      customerResults: 'Efficiency growth',
      companyFeatures: 'Fast delivery',
      businessValues: 'Innovation, Transparency',
      productBeliefs: 'AI for everyone',
      competitiveAdvantages: 'Lower cost',
      marketingExpectations: 'Brand awareness'
    };

    try {
      console.log(`Sending POST to /api/campaigns/${testCampaignId}/questionnaire`);
      const response = await axios.post(`${API_URL}/api/campaigns/${testCampaignId}/questionnaire`, questionnaireData, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });

      console.log("CREATE_RESPONSE:", JSON.stringify(response.data, null, 2));
      expect(response.status).toBe(201);
      expect(response.data.success).toBe(true);
    } catch (error: any) {
      console.error("DEBUG_DB_RESPONSE (CREATE):", error.response?.data || error.message);
      throw error;
    }
  });

  it('2. Retrieve record and check all 13 fields', async () => {
    try {
      console.log(`Sending GET to /api/campaigns/${testCampaignId}/questionnaire`);
      const response = await axios.get(`${API_URL}/api/campaigns/${testCampaignId}/questionnaire`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });

      console.log("GET_RESPONSE:", JSON.stringify(response.data, null, 2));
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);

      const data = response.data.data;
      expect(data).toBeDefined();
      expect(data).not.toBeNull();

      // Цикл проверки всех 13 полей
      console.log("Checking all 13 required fields in retrieved data...");
      requiredFields.forEach(field => {
        expect(data[field], `Field "${field}" is missing or undefined`).toBeDefined();
        expect(data[field], `Field "${field}" should not be undefined`).not.toBeUndefined();
        console.log(`✅ Field "${field}": ${data[field]}`);
      });

    } catch (error: any) {
      console.error("DEBUG_DB_RESPONSE (GET):", error.response?.data || error.message);
      throw error;
    }
  });

  it('3. Call /api/analyze-site and check all 13 fields from AI', async () => {
    try {
      console.log(`Sending POST to /api/analyze-site`);
      const response = await axios.post(`${API_URL}/api/analyze-site`, {
        url: 'https://google.com',
        campaignId: testCampaignId
      }, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 120000
      });

      console.log("ANALYZE_RESPONSE:", JSON.stringify(response.data, null, 2));
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);

      const data = response.data.data;
      expect(data).toBeDefined();

      // Цикл проверки всех 13 полей от AI
      console.log("Checking all 13 required fields in AI response...");
      requiredFields.forEach(field => {
        expect(data[field], `AI failed to return field "${field}"`).toBeDefined();
        expect(data[field], `AI returned field "${field}" as undefined`).not.toBeUndefined();
        console.log(`✅ AI Field "${field}": ${data[field]}`);
      });

    } catch (error: any) {
      console.error("DEBUG_DB_RESPONSE (ANALYZE):", error.response?.data || error.message);
      throw error;
    }
  }, 150000);

  it('4. Fail if any of the 13 fields are missing', async () => {
    const incompleteData = {
      companyName: 'Incomplete Company',
      // businessDescription is missing
      mainActivities: 'Missing some fields',
      campaignId: testCampaignId
    };

    try {
      console.log(`Sending invalid POST to /api/campaigns/${testCampaignId}/questionnaire`);
      const response = await axios.post(`${API_URL}/api/campaigns/${testCampaignId}/questionnaire`, incompleteData, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        validateStatus: (status) => status === 400
      });

      console.log("INVALID_POST_RESPONSE:", JSON.stringify(response.data, null, 2));
      expect(response.status).toBe(400);
      expect(response.data.error).toBe("Missing required fields");
      expect(response.data.missingFields).toContain('businessDescription');
      console.log("✅ Successfully caught missing fields validation");
    } catch (error: any) {
      console.error("FAILED_TO_CATCH_VALIDATION:", error.response?.data || error.message);
      throw error;
    }
  });
});
