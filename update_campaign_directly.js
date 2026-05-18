/**
 * Скрипт для прямого обновления настроек кампании с админским токеном
 */

import axios from 'axios';

const CAMPAIGN_ID = '46868c44-c6a4-4bed-accf-9ad07bba790e';
const DIRECTUS_URL = 'https://directus.roboflow.tech';

const socialMediaSettings = {
  "telegram": {
    "token": "7529101043:AAG298h0iubyeKPuZ-WRtEFbNEnEyqy_XJU",
    "chatId": "@ya_delayu_moschno"
  },
  "vk": {
    "token": "vk1.a.0jlmORGkgmds1qIB5btPIIuT1FZ8C_bkGpCcowI9Ml214neQFgVMiYEnePWq48txdx3D7oTtKbEvgnEifytkkyjv1FvooFsI0y_YYPX8Cw__525Tnqt_H7C9hEEdmsqHXExr4Q3DK7CL0quCvnhrhN368Ter9yFLe6buYgpnamBXwUx4yZnRJPdBVfnPmObtZRrXw7NaZJboCqAK8sXLEA",
    "groupId": "club228626989"
  },
  "instagram": {
    "token": "EAA520SFRtvcBO9Y7LhiiZBqwsqdZCP9JClMUoJZCvjsSc8qs9aheLdWefOqrZBLQhe5T0ZBerS6mZAZAP6D4i8Ln5UBfiIyVEif1LrzcAzG6JNrhW2DJeEzObpp9Mzoh8tDZA9I0HigkLnFZCaJVZCQcGDAkZBRxwnVimZBdbvokeg19i5RuGTbfuFs9UC9R",
    "accessToken": null,
    "businessAccountId": "17841422577074562"
  },
  "facebook": {
    "token": "EAA520SFRtvcBO40ZAUoxBvuj2y8mOjJ3SUZBcwG7ZAQFQXZA8z5dde8dCbQCP5WZA6NqMcZCUi9qbZBIwC8aqWIvZBHGUeGmMmbdAipFdU0N1W5bPDe1E8GJ98W5YM9rC1B6uvIE7E96RDcEj6LC1XpriuzGSWXTeLfFsYZCLpkOrXhbxDm1hXWWmccBKwuAn8KUoSfMI38a5",
    "pageId": "2120362494678794"
  },
  "youtube": {
    "apiKey": process.env.YOUTUBE_API_KEY,
    "channelId": "UCh-jDILbZG-CbS-hWJuiXjA"
  }
};

async function updateCampaignSettingsDirectly() {
  try {
    const adminToken = process.env.DIRECTUS_TOKEN;
    
    if (!adminToken) {
      throw new Error('DIRECTUS_TOKEN не настроен в переменных окружения');
    }

    console.log(`Обновление настроек кампании ${CAMPAIGN_ID} через Directus API...`);
    
    const response = await axios.patch(`${DIRECTUS_URL}/items/user_campaigns/${CAMPAIGN_ID}`, {
      social_media_settings: socialMediaSettings
    }, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('Настройки кампании успешно обновлены:');
    console.log('- Социальные сети настроены:', Object.keys(socialMediaSettings));
    console.log('- ID кампании:', response.data.data.id);
    console.log('- Название кампании:', response.data.data.name);
    
    // Проверим, что настройки сохранились
    const checkResponse = await axios.get(`${DIRECTUS_URL}/items/user_campaigns/${CAMPAIGN_ID}`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('\nПроверка: настройки социальных сетей в базе данных:');
    console.log(JSON.stringify(checkResponse.data.data.social_media_settings, null, 2));
    
  } catch (error) {
    console.error('Ошибка при обновлении настроек:', error.response?.data || error.message);
    
    if (error.response?.status === 401) {
      console.error('Ошибка авторизации - проверьте DIRECTUS_TOKEN в переменных окружения');
    } else if (error.response?.status === 404) {
      console.error('Кампания не найдена - проверьте ID кампании');
    }
  }
}

updateCampaignSettingsDirectly();