
import axios from 'axios';
import 'dotenv/config';

async function checkFields() {
  const url = process.env.DIRECTUS_URL || 'https://directus.roboflow.space';
  const token = process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_STATIC_TOKEN;

  try {
    console.log(`🔍 Проверка полей коллекции 'campaign_keywords' на ${url}...`);
    const res = await axios.get(`${url}/fields/campaign_keywords`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    console.log('✅ Поля найдены:');
    res.data.data.forEach(f => {
      console.log(`- ${f.field} (${f.type})`);
    });

    console.log(`\n🔍 Проверка полей коллекции 'business_questionnaire'...`);
    const res2 = await axios.get(`${url}/fields/business_questionnaire`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    console.log('✅ Поля найдены:');
    res2.data.data.forEach(f => {
      console.log(`- ${f.field} (${f.type})`);
    });

  } catch (err) {
    console.error('❌ Ошибка:', err.response?.status, err.response?.data || err.message);
  }
}

checkFields();
