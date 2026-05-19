const axios = require('axios');

// Используем системный токен из .env
require('dotenv').config();
const directusToken = process.env.DIRECTUS_TOKEN;
const campaignId = 'cb3757df-c684-4809-9b13-49862c108db8';

async function testCampaignDirect() {
  try {
    console.log('🧪 Testing campaign access with system token...');
    console.log('📋 Campaign ID:', campaignId);
    console.log('📋 Using DIRECTUS_TOKEN:', directusToken ? 'YES' : 'NO');
    
    const response = await axios.get(
      `${process.env.DIRECTUS_URL}/items/user_campaigns/${campaignId}`,
      {
        headers: {
          'Authorization': `Bearer ${directusToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('✅ Campaign data:', JSON.stringify(response.data.data, null, 2));
    console.log('📋 Social media settings:', JSON.stringify(response.data.data.social_media_settings, null, 2));
    
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
    console.error('❌ Status:', error.response?.status);
  }
}

testCampaignDirect();