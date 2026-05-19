
import axios from 'axios';
import 'dotenv/config';

async function checkCollections() {
  const url = process.env.DIRECTUS_URL || 'https://directus.roboflow.space';
  const token = process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_STATIC_TOKEN;

  console.log(`🔍 Проверка коллекций на ${url} с использованием ADMIN_TOKEN...`);

  const collections = [
    'user_campaigns',
    'campaign_content',
    'campaign_keywords',
    'business_questionnaire'
  ];

  for (const col of collections) {
    try {
      const res = await axios.get(`${url}/items/${col}`, {
        params: { limit: 1 },
        headers: { Authorization: `Bearer ${token}` }
      });
      console.log(`✅ Коллекция '${col}' доступна. Найдено записей: ${res.data.data?.length || 0}`);
    } catch (err) {
      console.log(`❌ Ошибка доступа к '${col}': ${err.response?.status} ${err.response?.statusText || err.message}`);
    }
  }
}

checkCollections();
