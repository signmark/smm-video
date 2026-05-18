/**
 * Прямой тест получения данных кампании
 */

const axios = require('axios');

async function testCampaignDataDirect() {
  const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjUzOTIxZjE2LWY1MWQtNDU5MS04MGI5LThjYWE0ZmRlNGQxMyIsInJvbGUiOiIyODViZGU2OS0yZjA0LTRmM2YtOTg5Yy1mN2RmZWMzZGQ0MDUiLCJhcHBfYWNjZXNzIjp0cnVlLCJhZG1pbl9hY2Nlc3MiOnRydWUsImlhdCI6MTc0ODM3MDUwMCwiZXhwIjoxNzQ4MzcxNDAwLCJpc3MiOiJkaXJlY3R1cyJ9.yEB-GlnPqv5jkm-v_5AnLsOhH_2LW2JSCQa_sW9ivwM';
  const userId = '53921f16-f51d-4591-80b9-8caa4fde4d13';

  try {
    console.log('🔍 Тестируем прямое получение данных кампании...');
    
    // Проверяем соединение с API
    const directusApi = axios.create({
      baseURL: 'https://directus.nplanner.ru',
      timeout: 10000
    });

    console.log('1️⃣ Получаем список кампаний пользователя...');
    const campaignsResponse = await directusApi.get('/items/user_campaigns', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      params: {
        filter: {
          user_id: { _eq: userId }
        },
        limit: 1,
        sort: ['-date_created']
      }
    });

    console.log('✅ Кампании получены:', campaignsResponse.data);

    const campaigns = campaignsResponse.data?.data;
    if (campaigns && campaigns.length > 0) {
      const campaignId = campaigns[0].id;
      console.log(`2️⃣ Получаем данные кампании: ${campaignId}`);

      const campaignResponse = await directusApi.get(`/items/user_campaigns/${campaignId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      console.log('✅ Данные кампании:', JSON.stringify(campaignResponse.data, null, 2));

      // Получаем анкету
      if (campaignResponse.data?.data?.questionnaire_id) {
        console.log('3️⃣ Получаем анкету...');
        const questionnaireResponse = await directusApi.get(`/items/questionnaires/${campaignResponse.data.data.questionnaire_id}`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        console.log('✅ Анкета:', JSON.stringify(questionnaireResponse.data, null, 2));
      }

    } else {
      console.log('❌ Кампании не найдены');
    }

  } catch (error) {
    console.error('❌ Ошибка тестирования:', error.response?.data || error.message);
  }
}

testCampaignDataDirect();