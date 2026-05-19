const axios = require('axios');

// Данные из attached_assets для тестирования
const campaignId = 'cb3757df-c684-4809-9b13-49862c108db8';
const userToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjUzOTIxZjE2LWY1MWQtNDU5MS04MGI5LThjYWE0ZmRlNGQxMyIsInJvbGUiOiIyODViZGU2OS0yZjA0LTRmM2YtOTg5Yy1mN2RmZWMzZGQ0MDUiLCJhcHBfYWNjZXNzIjoxLCJhZG1pbl9hY2Nlc3MiOjAsInNoYXJlIjpbXSwiaWF0IjoxNzUzODYyMDk5LCJleHAiOjE3NTM4NjM4OTksImlzcyI6ImRpcmVjdHVzIn0.jJpA-gU4vIGWIWKXCZgKjKKnZOa7TPhvzLj74BwqWew';

async function testInstagramSettingsLoad() {
  try {
    console.log('🧪 Testing Instagram settings load...');
    console.log('📋 Campaign ID:', campaignId);
    
    const response = await axios.get(
      `http://localhost:5000/api/campaigns/${campaignId}/instagram-settings`,
      {
        headers: {
          'Authorization': `Bearer ${userToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('✅ Response:', JSON.stringify(response.data, null, 2));
    console.log('✅ Status:', response.status);
    
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
    console.error('❌ Status:', error.response?.status);
  }
}

testInstagramSettingsLoad();