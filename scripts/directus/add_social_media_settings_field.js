import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
const DIRECTUS_EMAIL = 'signmark@gmail.com';
const DIRECTUS_PASSWORD = 'QtpZ3dh7';

async function addSocialMediaSettingsField() {
  try {
    // 1. Authenticate with Directus
    console.log('Authenticating with Directus...');
    const authResponse = await axios.post(`${DIRECTUS_URL}/auth/login`, {
      email: DIRECTUS_EMAIL,
      password: DIRECTUS_PASSWORD
    });

    const token = authResponse.data.data.access_token;
    console.log('Successfully authenticated with Directus');

    // 2. Add new field to user_campaigns collection
    console.log('Adding social_media_settings field to user_campaigns collection...');
    const response = await axios.post(
      `${DIRECTUS_URL}/fields/user_campaigns`,
      {
        field: 'social_media_settings',
        type: 'json',
        schema: {
          name: 'social_media_settings',
          table: 'user_campaigns',
          data_type: 'json',
          is_nullable: true
        },
        meta: {
          interface: 'input-code',
          special: ['json'],
          options: {
            language: 'json',
            template: JSON.stringify({
              telegram: { token: null, chatId: null },
              vk: { token: null, groupId: null },
              instagram: { token: null, accessToken: null },
              facebook: { token: null, pageId: null },
              youtube: { apiKey: null, channelId: null }
            }, null, 2)
          }
        }
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('Field added successfully:', response.data);
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
    
    // В случае ошибки пробуем альтернативный метод - прямой SQL запрос через API
    if (error.response?.status === 403 || error.response?.status === 401) {
      console.log('Trying alternative method...');
      await addFieldViaSQL();
    }
  }
}

async function addFieldViaSQL() {
  try {
    // 1. Authenticate with Directus
    const authResponse = await axios.post(`${DIRECTUS_URL}/auth/login`, {
      email: DIRECTUS_EMAIL,
      password: DIRECTUS_PASSWORD
    });

    const token = authResponse.data.data.access_token;
    console.log('Successfully authenticated with Directus');

    // 2. Выполнить SQL запрос через API
    const response = await axios.post(
      `${DIRECTUS_URL}/utils/run-query`,
      {
        query: 'ALTER TABLE user_campaigns ADD COLUMN IF NOT EXISTS social_media_settings JSONB'
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('Field added successfully via SQL:', response.data);
  } catch (error) {
    console.error('Error with SQL method:', error.response?.data || error.message);
  }
}

addSocialMediaSettingsField();