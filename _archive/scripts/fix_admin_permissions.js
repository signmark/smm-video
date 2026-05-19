/**
 * Скрипт для исправления прав администратора для пользователя lbrspb@gmail.com
 * Обновляет роль пользователя на Administrator в Directus
 */

async function fixAdminPermissions() {
  const DIRECTUS_URL = 'https://directus.roboflow.tech';
  
  console.log('🔧 Исправляем права администратора для lbrspb@gmail.com...');
  
  try {
    // Получаем токен администратора из переменных среды
    const adminToken = process.env.DIRECTUS_TOKEN;
    if (!adminToken) {
      console.error('❌ Отсутствует DIRECTUS_TOKEN в переменных среды');
      process.exit(1);
    }
    
    // 1. Получаем информацию о пользователе
    console.log('📋 Получаем информацию о пользователе...');
    const userResponse = await fetch(`${DIRECTUS_URL}/users?filter[email][_eq]=lbrspb@gmail.com`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!userResponse.ok) {
      throw new Error(`Ошибка получения пользователя: ${userResponse.status}`);
    }
    
    const userData = await userResponse.json();
    console.log('👤 Данные пользователя:', JSON.stringify(userData, null, 2));
    
    if (!userData.data || userData.data.length === 0) {
      console.error('❌ Пользователь lbrspb@gmail.com не найден');
      process.exit(1);
    }
    
    const user = userData.data[0];
    console.log(`📧 Найден пользователь: ${user.email} (ID: ${user.id})`);
    console.log(`🔖 Текущая роль: ${user.role || 'не назначена'}`);
    
    // 2. Получаем роль Administrator
    console.log('🔍 Поиск роли Administrator...');
    const rolesResponse = await fetch(`${DIRECTUS_URL}/roles?filter[name][_eq]=Administrator`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!rolesResponse.ok) {
      throw new Error(`Ошибка получения ролей: ${rolesResponse.status}`);
    }
    
    const rolesData = await rolesResponse.json();
    console.log('🔐 Данные ролей:', JSON.stringify(rolesData, null, 2));
    
    if (!rolesData.data || rolesData.data.length === 0) {
      console.error('❌ Роль Administrator не найдена');
      process.exit(1);
    }
    
    const adminRole = rolesData.data[0];
    console.log(`🛡️ Найдена роль Administrator: ${adminRole.name} (ID: ${adminRole.id})`);
    
    // 3. Обновляем роль пользователя
    console.log('⚡ Назначаем права администратора...');
    const updateResponse = await fetch(`${DIRECTUS_URL}/users/${user.id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        role: adminRole.id
      })
    });
    
    if (!updateResponse.ok) {
      const errorData = await updateResponse.json();
      throw new Error(`Ошибка обновления пользователя: ${updateResponse.status} - ${JSON.stringify(errorData)}`);
    }
    
    const updatedUser = await updateResponse.json();
    console.log('✅ Пользователь успешно обновлен:', JSON.stringify(updatedUser, null, 2));
    
    // 4. Проверяем результат
    console.log('🔍 Проверяем результат...');
    const verifyResponse = await fetch(`${DIRECTUS_URL}/users/${user.id}`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (verifyResponse.ok) {
      const verifyData = await verifyResponse.json();
      console.log(`✅ Пользователь ${verifyData.data.email} теперь имеет роль: ${verifyData.data.role}`);
      console.log('🎉 Права администратора успешно назначены!');
    }
    
  } catch (error) {
    console.error('❌ Ошибка при исправлении прав:', error.message);
    process.exit(1);
  }
}

// Запускаем скрипт
fixAdminPermissions();