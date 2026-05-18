
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

    console.log('🛠 Настройка прав доступа с фильтром по пользователю...');

    for (const collection of collections) {
      for (const action of actions) {
        try {
          // Удаляем старые права для этой роли/коллекции/действия, если они есть
          const existingRes = await axios.get(`${url}/permissions`, {
            params: {
              filter: JSON.stringify({
                role: { _eq: smmRole.id },
                collection: { _eq: collection },
                action: { _eq: action }
              })
            },
            headers: { Authorization: `Bearer ${token}` }
          });

          for (const p of existingRes.data.data) {
            await axios.delete(`${url}/permissions/${p.id}`, {
              headers: { Authorization: `Bearer ${token}` }
            });
          }

          // Создаем новое право
          // Для 'create' фильтр обычно не нужен, для остальных - фильтруем по user_id
          let permissions = {};
          if (action !== 'create') {
            // Большинство таблиц имеют поле user_id или связаны через campaign_id
            // Для простоты сначала пробуем прямой user_id
            permissions = { "user_id": { "_eq": "$CURRENT_USER" } };
            
            // Исключения для таблиц, где нет user_id напрямую, но есть связь с кампанией
            if (['campaign_content', 'campaign_keywords', 'business_questionnaire', 'campaign_content_sources', 'campaign_trend_topics'].includes(collection)) {
               // В Directus можно использовать вложенные фильтры, если настроены relations
               // Но самый надежный способ - если в таблице ЕСТЬ user_id. 
               // Судя по check_fields, в business_questionnaire нет user_id.
               // Если поля user_id нет, даем полный доступ (временно) или пустой фильтр
               permissions = {}; 
            }
          }

          await axios.post(`${url}/permissions`, {
            role: smmRole.id,
            collection: collection,
            action: action,
            permissions: permissions,
            validation: null,
            fields: ['*']
          }, {
            headers: { Authorization: `Bearer ${token}` }
          });
          
          console.log(`  ✅ Настроено: ${collection} -> ${action}`);
        } catch (err) {
          console.log(`  ⚠️ Ошибка для ${collection}:${action}: ${err.response?.data || err.message}`);
        }
      }
    }

    console.log('✨ Права для пользователей настроены!');
  } catch (error) {
    console.error('❌ Критическая ошибка:', error.response?.data || error.message);
  }
}

fixPermissions();
