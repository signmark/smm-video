/**
 * Скрипт для улучшения интерфейса Global API Keys в Directus
 */

import axios from 'axios';

const DIRECTUS_URL = 'https://directus.roboflow.tech';
const ADMIN_EMAIL = 'lbrspb@gmail.com';
const ADMIN_PASSWORD = 'QtpZ3dh7';

async function updateGlobalApiKeysInterface() {
  try {
    console.log('=== Улучшение интерфейса Global API Keys ===\n');

    // Авторизация
    console.log('Авторизация администратора...');
    const authResponse = await axios.post(`${DIRECTUS_URL}/auth/login`, {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD
    });

    const token = authResponse.data.data.access_token;
    console.log('✅ Авторизация успешна');

    // Обновляем поля коллекции для лучшего отображения
    console.log('\nОбновление полей коллекции global_api_keys...');

    const fieldsToUpdate = [
      {
        field: 'service_name',
        meta: {
          display: 'raw',
          display_options: {
            placeholder: 'Например: gemini, claude, openai'
          },
          note: 'Название AI сервиса',
          width: 'half'
        }
      },
      {
        field: 'api_key',
        meta: {
          display: 'formatted-value',
          display_options: {
            format: true,
            prefix: '••••••••',
            color: '#6366f1'
          },
          note: 'API ключ (будет скрыт в интерфейсе)',
          width: 'full'
        }
      },
      {
        field: 'is_active',
        meta: {
          display: 'boolean',
          display_options: {
            labelOn: 'Активен',
            labelOff: 'Отключен',
            colorOn: '#059669',
            colorOff: '#dc2626'
          },
          note: 'Включен ли ключ',
          width: 'half'
        }
      },
      {
        field: 'description',
        meta: {
          display: 'formatted-value',
          display_options: {
            format: true,
            bold: false
          },
          note: 'Описание назначения ключа',
          width: 'full'
        }
      }
    ];

    // Обновляем каждое поле
    for (const fieldUpdate of fieldsToUpdate) {
      try {
        const response = await axios.patch(
          `${DIRECTUS_URL}/fields/global_api_keys/${fieldUpdate.field}`,
          fieldUpdate,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          }
        );
        console.log(`✅ Поле ${fieldUpdate.field} обновлено`);
      } catch (fieldError) {
        console.log(`⚠️ Не удалось обновить поле ${fieldUpdate.field}:`, fieldError.response?.data?.errors?.[0]?.message || fieldError.message);
      }
    }

    // Обновляем настройки коллекции
    console.log('\nОбновление настроек коллекции...');
    try {
      await axios.patch(`${DIRECTUS_URL}/collections/global_api_keys`, {
        meta: {
          display_template: '{{service_name}} - {{description}}',
          note: 'Управление API ключами для всех AI сервисов платформы',
          sort_field: 'service_name'
        }
      }, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      console.log('✅ Настройки коллекции обновлены');
    } catch (collectionError) {
      console.log('⚠️ Не удалось обновить настройки коллекции:', collectionError.response?.data?.errors?.[0]?.message);
    }

    // Проверяем текущие записи
    console.log('\nПроверка существующих API ключей...');
    const keysResponse = await axios.get(`${DIRECTUS_URL}/items/global_api_keys`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log(`✅ Найдено ${keysResponse.data.data.length} API ключей:`);
    keysResponse.data.data.forEach(key => {
      const status = key.is_active ? '🟢 Активен' : '🔴 Отключен';
      console.log(`  - ${key.service_name}: ${status}`);
      if (key.description) {
        console.log(`    ${key.description}`);
      }
    });

    console.log('\n=== Интерфейс Global API Keys улучшен ===');
    console.log('Теперь в Directus админке поля будут отображаться с красивым форматированием');

  } catch (error) {
    console.error('Ошибка при улучшении интерфейса:');
    console.error('Статус:', error.response?.status);
    console.error('Данные ошибки:', JSON.stringify(error.response?.data, null, 2));
  }
}

updateGlobalApiKeysInterface();