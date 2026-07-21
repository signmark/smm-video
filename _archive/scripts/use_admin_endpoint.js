/**
 * Скрипт для обновления настроек кампании через новый admin эндпоинт
 */

import axios from 'axios';

const SERVER_URL = 'http://localhost:5000';
const CAMPAIGN_ID = '46868c44-c6a4-4bed-accf-9ad07bba790e';

const socialMediaSettings = {
  "telegram": {
    "token": process.env.TELEGRAM_BOT_TOKEN,
    "chatId": "@ya_delayu_moschno"
  },
  "vk": {
    "token": process.env.VK_ACCESS_TOKEN,
    "groupId": "club228626989"
  },
  "instagram": {
    "token": process.env.FACEBOOK_ACCESS_TOKEN,
    "accessToken": null,
    "businessAccountId": "17841422577074562"
  },
  "facebook": {
    "token": process.env.INSTAGRAM_TOKEN,
    "pageId": "2120362494678794"
  },
  "youtube": {
    "apiKey": process.env.YOUTUBE_API_KEY,
    "channelId": "UCh-jDILbZG-CbS-hWJuiXjA"
  }
};

async function updateCampaignViaAdminEndpoint() {
  try {
    console.log(`Обновление настроек кампании ${CAMPAIGN_ID} через admin эндпоинт...`);
    
    const response = await axios.post(`${SERVER_URL}/api/admin/update-campaign-settings/${CAMPAIGN_ID}`, {
      social_media_settings: socialMediaSettings
    });

    console.log('✅ Настройки кампании успешно обновлены!');
    console.log('📱 Настроенные платформы:', response.data.updated_platforms);
    console.log('📋 Ответ сервера:', response.data);
    
    return response.data;
    
  } catch (error) {
    console.error('❌ Ошибка при обновлении настроек:', error.response?.data || error.message);
    
    if (error.response?.status === 404) {
      console.error('🔍 Кампания не найдена - проверьте ID кампании');
    } else if (error.response?.status === 500) {
      console.error('🛠️ Ошибка сервера - проверьте логи приложения');
    }
    
    throw error;
  }
}

updateCampaignViaAdminEndpoint();
