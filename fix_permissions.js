
import axios from 'axios';
import 'dotenv/config';

async function fixPermissions() {
  const url = process.env.DIRECTUS_URL || 'https://directus.roboflow.space';
  const email = process.env.DIRECTUS_ADMIN_EMAIL;
  const password = process.env.DIRECTUS_ADMIN_PASSWORD;

  console.log(`🚀 Начинаю исправление прав на ${url}...`);

  try {
    // 1. Авторизация
    const authRes = await axios.post(`${url}/auth/login`, { email, password });
    const token = authRes.data.data.access_token;
    console.log('✅ Авторизация успешна');

    // 2. Получаем ID роли SMM Manager User
    const rolesRes = await axios.get(`${url}/roles`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    const smmRole = rolesRes.data.data.find(r => r.name.includes('SMM'));
    if (!smmRole) {
      console.error('❌ Роль SMM Manager не найдена. Проверьте настройки ролей в Directus.');
      return;
    }
    console.log(`👤 Найдена роль: ${smmRole.name} (ID: ${smmRole.id})`);

    const collections = [
      'user_campaigns',
      'campaign_content',
      'campaign_keywords',
      'business_questionnaire',
      'campaign_content_sources',
      'campaign_trend_topics',
      'source_posts'
    ];

    const actions = ['create', 'read', 'update', 'delete'];

    console.log('🛠 Обновляю права доступа...');

    for (const collection of collections) {
      for (const action of actions) {
        try {
          // Проверяем, существует ли уже такое право
          const checkRes = await axios.get(`${url}/permissions`, {
            params: {
              filter: JSON.stringify({
                role: { _eq: smmRole.id },
                collection: { _eq: collection },
                action: { _eq: action }
              })
            },
            headers: { Authorization: `Bearer ${token}` }
          });

          if (checkRes.data.data.length === 0) {
            // Создаем право, если его нет
            await axios.post(`${url}/permissions`, {
              role: smmRole.id,
              collection: collection,
              action: action,
              permissions: {},
              validation: null,
              fields: ['*']
            }, {
              headers: { Authorization: `Bearer ${token}` }
            });
            console.log(`  ✅ Добавлено: ${collection} -> ${action}`);
          } else {
            console.log(`  ℹ️ Уже есть: ${collection} -> ${action}`);
          }
        } catch (err) {
          console.log(`  ⚠️ Ошибка для ${collection}:${action}: ${err.message}`);
        }
      }
    }

    console.log('✨ Все права успешно настроены!');
  } catch (error) {
    console.error('❌ Критическая ошибка:', error.response?.data || error.message);
  }
}

fixPermissions();
