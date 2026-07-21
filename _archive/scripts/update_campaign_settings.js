/**
 * Скрипт для обновления настроек социальных сетей кампании
 */

import axios from 'axios';

const CAMPAIGN_ID = '46868c44-c6a4-4bed-accf-9ad07bba790e';
const SERVER_URL = 'http://localhost:5000';

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

async function getAuthToken() {
  try {
    // Используем стандартные учетные данные для Replit
    const loginResponse = await axios.post(`${SERVER_URL}/api/auth/login`, {
      email: process.env.DIRECTUS_ADMIN_EMAIL,
      password: process.env.DIRECTUS_ADMIN_PASSWORD
    });

    return loginResponse.data.token;
  } catch (error) {
    console.error('Ошибка авторизации:', error.response?.data || error.message);
    throw error;
  }
}

async function updateCampaignSettings() {
  try {
    console.log('Получение токена авторизации...');
    const token = await getAuthToken();
    console.log('Токен получен успешно');

    console.log(`Обновление настроек кампании ${CAMPAIGN_ID}...`);
    const response = await axios.patch(`${SERVER_URL}/api/campaigns/${CAMPAIGN_ID}`, {
      social_media_settings: socialMediaSettings
    }, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('Настройки кампании успешно обновлены:', response.data);
    console.log('Социальные сети настроены:', Object.keys(socialMediaSettings));
  } catch (error) {
    console.error('Ошибка при обновлении настроек:', error.response?.data || error.message);
    
    if (error.response?.status === 401) {
      console.error('Ошибка авторизации - проверьте учетные данные');
    } else if (error.response?.status === 404) {
      console.error('Кампания не найдена - проверьте ID кампании');
    } else if (error.response?.status === 403) {
      console.error('Доступ запрещен - возможно, кампания принадлежит другому пользователю');
    }
  }
}

updateCampaignSettings();
