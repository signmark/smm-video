
import axios from 'axios';
import 'dotenv/config';

async function checkUserRole() {
  const url = process.env.DIRECTUS_URL || 'https://directus.roboflow.space';
  const token = process.env.DIRECTUS_ADMIN_TOKEN || process.env.DIRECTUS_STATIC_TOKEN;

  try {
    // Получаем список пользователей
    const res = await axios.get(`${url}/users`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    console.log('👥 Список пользователей и их ролей:');
    res.data.data.forEach(u => {
      console.log(`- ${u.first_name} ${u.last_name} (${u.email}): Роль ID = ${u.role}`);
    });

    // Получаем детали ролей
    const rolesRes = await axios.get(`${url}/roles`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    console.log('\n👤 Детали ролей:');
    rolesRes.data.data.forEach(r => {
      console.log(`- ${r.name} (ID: ${r.id})`);
    });

  } catch (err) {
    console.error('❌ Ошибка:', err.response?.data || err.message);
  }
}

checkUserRole();
