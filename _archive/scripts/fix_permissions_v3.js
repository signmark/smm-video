
import axios from 'axios';
import 'dotenv/config';

async function fixPermissions() {
  const url = process.env.DIRECTUS_URL || 'https://directus.roboflow.space';
  const token = process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_STATIC_TOKEN;

  console.log(`🚀 Начинаю глобальное исправление прав на ${url}...`);

  try {
    // 1. Получаем ID роли SMM Manager User
    const rolesRes = await axios.get(`${url}/roles`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    const smmRole = rolesRes.data.data.find(r => r.name.includes('SMM'));
    if (!smmRole) {
      console.error('❌ Роль SMM Manager не найдена.');
      return;
    }
    const roleId = smmRole.id;
    console.log(`👤 Найдена роль: ${smmRole.name} (ID: ${roleId})`);

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

    console.log('🛠 Очистка и настройка прав доступа...');

    for (const collection of collections) {
      for (const action of actions) {
        try {
          // 1. Сначала удаляем ВСЕ существующие права для этой роли/коллекции/действия
          const existingRes = await axios.get(`${url}/permissions`, {
            params: {
              filter: JSON.stringify({
                role: { _eq: roleId },
                collection: { _eq: collection },
                action: { _eq: action }
              })
            },
            headers: { Authorization: `Bearer ${token}` }
          });

          if (existingRes.data.data && existingRes.data.data.length > 0) {
            for (const p of existingRes.data.data) {
              await axios.delete(`${url}/permissions/${p.id}`, {
                headers: { Authorization: `Bearer ${token}` }
              });
            }
          }

          // 2. Создаем новое право
          let permissions = {};
          
          // Логика фильтрации:
          // Если в таблице есть user_id, фильтруем по нему.
          // Если нет (как в business_questionnaire), пока даем полный доступ (или можно через вложенный фильтр по campaign_id.user_id)
          
          if (action !== 'create') {
            if (['user_campaigns', 'campaign_content', 'source_posts'].includes(collection)) {
              permissions = { "user_id": { "_eq": "$CURRENT_USER" } };
            } else {
              // Для остальных коллекций (keywords, questionnaire и т.д.) 
              // пока разрешаем всё, так как они привязаны к кампаниям
              permissions = {}; 
            }
          }

          await axios.post(`${url}/permissions`, {
            role: roleId,
            collection: collection,
            action: action,
            permissions: permissions,
            validation: null,
            fields: ['*']
          }, {
            headers: { Authorization: `Bearer ${token}` }
          });
          
          console.log(`  ✅ OK: ${collection} -> ${action}`);
        } catch (err) {
          const errorDetail = err.response?.data?.errors?.[0]?.message || err.message;
          console.log(`  ⚠️ Ошибка для ${collection}:${action}: ${errorDetail}`);
        }
      }
    }

    console.log('\n✨ Права для пользователей успешно обновлены!');
    console.log('Администраторы (роль Administrator) по умолчанию имеют полный доступ ко всему.');
  } catch (error) {
    const errorDetail = error.response?.data?.errors?.[0]?.message || error.message;
    console.error('❌ Критическая ошибка:', errorDetail);
  }
}

fixPermissions();
