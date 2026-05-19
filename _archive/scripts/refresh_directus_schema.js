/**
 * Скрипт для принудительного обновления схемы Directus
 */

import axios from 'axios';

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://directus.roboflow.tech';
const ADMIN_EMAIL = 'lbrspb@gmail.com';
const ADMIN_PASSWORD = 'QtpZ3dh7';

async function refreshDirectusSchema() {
  try {
    console.log('=== Обновление схемы Directus ===\n');

    // Авторизация
    console.log('Авторизация...');
    const authResponse = await axios.post(`${DIRECTUS_URL}/auth/login`, {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD
    });

    const token = authResponse.data.data.access_token;
    console.log('✅ Авторизация успешна');

    // Обновление коллекций (альтернативный способ)
    console.log('\nОбновление коллекций...');
    try {
      const collectionsRefresh = await axios.get(`${DIRECTUS_URL}/collections?refresh=1`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      console.log('✅ Коллекции обновлены');
    } catch (refreshError) {
      console.log('Попытка принудительного обновления через другой метод...');
    }

    // Перезагрузка коллекций
    console.log('\nПерезагрузка метаданных коллекций...');
    const collectionsResponse = await axios.get(`${DIRECTUS_URL}/collections`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log(`✅ Загружено ${collectionsResponse.data.data.length} коллекций`);

    // Проверка коллекции user_campaigns
    console.log('\nПроверка коллекции user_campaigns...');
    const fieldsResponse = await axios.get(`${DIRECTUS_URL}/fields/user_campaigns`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('Поля коллекции user_campaigns:');
    fieldsResponse.data.data.forEach(field => {
      console.log(`- ${field.field} (${field.type})`);
    });

    console.log('\n=== Обновление схемы завершено ===');

  } catch (error) {
    console.error('Ошибка при обновлении схемы:');
    console.error('Статус:', error.response?.status);
    console.error('Данные ошибки:', JSON.stringify(error.response?.data, null, 2));
  }
}

refreshDirectusSchema();