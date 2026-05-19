// Финальный тест Instagram OAuth системы
import axios from 'axios';

const BASE_URL = 'http://localhost:5000';
const CAMPAIGN_ID = 'cb3757df-c684-4809-9b13-49862c108db8'; // Кампания с Instagram настройками
const ADMIN_TOKEN = process.env.DIRECTUS_TOKEN;

async function testInstagramOAuthSystem() {
  console.log('🚀 FINAL INSTAGRAM OAUTH SYSTEM TEST');
  console.log('================================');
  
  try {
    // 1. Проверяем Instagram настройки кампании напрямую через Directus
    console.log('\n1️⃣ CHECKING CAMPAIGN IN DIRECTUS...');
    const directusResponse = await axios.get(
      `${process.env.DIRECTUS_URL}/items/user_campaigns/${CAMPAIGN_ID}?fields=*`,
      {
        headers: {
          'Authorization': `Bearer ${ADMIN_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const campaign = directusResponse.data.data;
    const instagramSettings = campaign.social_media_settings?.instagram;
    
    console.log('📋 Campaign found:', campaign.name);
    console.log('📋 Instagram settings:', {
      exists: !!instagramSettings,
      appId: instagramSettings?.appId,
      hasLongLivedToken: !!instagramSettings?.longLivedToken?.length,
      tokenLength: instagramSettings?.longLivedToken?.length,
      hasUser: !!instagramSettings?.user,
      authTimestamp: instagramSettings?.authTimestamp
    });
    
    // 2. Тестируем GET endpoint для Instagram settings
    console.log('\n2️⃣ TESTING GET INSTAGRAM SETTINGS ENDPOINT...');
    try {
      const getResponse = await axios.get(
        `${BASE_URL}/api/campaigns/${CAMPAIGN_ID}/instagram-settings`,
        {
          headers: {
            'Authorization': `Bearer ${ADMIN_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      console.log('✅ GET endpoint successful');
      console.log('📋 Response:', {
        success: getResponse.data.success,
        hasSettings: !!getResponse.data.settings,
        appId: getResponse.data.settings?.appId,
        hasToken: !!getResponse.data.settings?.longLivedToken
      });
      
    } catch (getError) {
      console.log('❌ GET endpoint failed:', getError.response?.data || getError.message);
    }
    
    // 3. Проверяем что OAuth данные корректны
    console.log('\n3️⃣ VALIDATING OAUTH DATA...');
    if (instagramSettings?.longLivedToken) {
      console.log('✅ Long-lived token exists');
      console.log('📋 Token preview:', instagramSettings.longLivedToken.substring(0, 30) + '...');
      
      if (instagramSettings.user) {
        console.log('✅ User data exists:', {
          id: instagramSettings.user.id,
          name: instagramSettings.user.name
        });
      }
      
      if (instagramSettings.authTimestamp) {
        console.log('✅ Auth timestamp:', instagramSettings.authTimestamp);
        const authDate = new Date(instagramSettings.authTimestamp);
        const now = new Date();
        const hoursSinceAuth = (now - authDate) / (1000 * 60 * 60);
        console.log('📋 Hours since authorization:', hoursSinceAuth.toFixed(1));
      }
    } else {
      console.log('❌ No long-lived token found');
    }
    
    // 4. Тестируем mapping данных для формы
    console.log('\n4️⃣ TESTING FORM DATA MAPPING...');
    const formData = {
      appId: instagramSettings?.appId || '',
      appSecret: instagramSettings?.appSecret || '',
      instagramId: instagramSettings?.businessAccountId || instagramSettings?.instagramId || '',
      accessToken: instagramSettings?.longLivedToken || instagramSettings?.token || ''
    };
    
    console.log('📋 Form data mapping:', {
      appId: formData.appId ? 'present' : 'missing',
      appSecret: formData.appSecret ? 'present' : 'missing', 
      instagramId: formData.instagramId || 'empty',
      accessToken: formData.accessToken ? 'present (' + formData.accessToken.length + ' chars)' : 'missing'
    });
    
    console.log('\n✅ Instagram OAuth system test completed!');
    console.log('📋 Summary:');
    console.log('   - Database has OAuth data:', !!instagramSettings);
    console.log('   - Has access token:', !!instagramSettings?.longLivedToken);
    console.log('   - Form can be populated:', !!(formData.appId && formData.accessToken));
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

// Запускаем тест
testInstagramOAuthSystem();