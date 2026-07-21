/**
 * Тестовый скрипт для проверки получения Instagram Business Account ID
 */

import axios from 'axios';

async function testInstagramBusinessIdFetch() {
  console.log('🧪 Testing Instagram Business Account ID fetch...');
  
  const testData = {
    campaignId: 'cb3757df-c684-4809-9b13-49862c108db8',
    accessToken: process.env.INSTAGRAM_TOKEN,
    userToken: process.env.DIRECTUS_USER_TOKEN,
  };
  
  try {
    console.log('📋 Campaign ID:', testData.campaignId);
    console.log('📋 Access Token (first 20 chars):', testData.accessToken.substring(0, 20) + '...');
    
    const response = await axios.post(
      `http://localhost:5000/api/campaigns/${testData.campaignId}/fetch-instagram-business-id`,
      {
        accessToken: testData.accessToken
      },
      {
        headers: {
          'Authorization': `Bearer ${testData.userToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('✅ Response Status:', response.status);
    console.log('✅ Response Data:', JSON.stringify(response.data, null, 2));
    
    if (response.data.success) {
      console.log('🎉 Instagram Business Account ID successfully fetched:', response.data.businessAccountId);
    } else {
      console.log('❌ Failed to fetch Business Account ID:', response.data.error);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
    console.error('❌ Status:', error.response?.status);
  }
}

// Запускаем тест
testInstagramBusinessIdFetch();
