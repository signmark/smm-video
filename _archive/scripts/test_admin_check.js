/**
 * Тест проверки прав администратора с токеном из браузера
 */

// Имитируем запрос как из браузера
async function testAdminCheck() {
  console.log('🔍 Тестируем проверку прав администратора...');
  
  try {
    // Используем fetch для эмуляции браузерного запроса
    const response = await fetch('http://localhost:5000/api/auth/is-admin', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer test_token_from_browser`,
        'Content-Type': 'application/json'
      }
    });
    
    const result = await response.json();
    console.log('📋 Результат проверки:', JSON.stringify(result, null, 2));
    
    if (result.success && result.isAdmin) {
      console.log('✅ Пользователь распознан как администратор');
    } else {
      console.log('❌ Пользователь НЕ распознан как администратор');
      console.log('🔧 Нужно исправить логику проверки прав');
    }
    
  } catch (error) {
    console.error('❌ Ошибка при тестировании:', error.message);
  }
}

// Второй тест - напрямую через функцию isUserAdmin
async function testIsUserAdminFunction() {
  console.log('\n🔍 Тестируем функцию isUserAdmin напрямую...');
  
  try {
    // Импортируем функцию
    const { isUserAdmin } = await import('./server/routes-global-api-keys.js');
    
    // Создаем фейковый запрос
    const mockReq = {
      headers: {
        authorization: 'Bearer test_token'
      }
    };
    
    const result = await isUserAdmin(mockReq);
    console.log('📋 Результат isUserAdmin:', result);
    
  } catch (error) {
    console.error('❌ Ошибка при тестировании isUserAdmin:', error.message);
  }
}

// Третий тест - получение данных пользователя напрямую из Directus
async function testDirectusUserData() {
  console.log('\n🔍 Тестируем получение данных пользователя из Directus...');
  
  try {
    const directusUrl = 'https://directus.roboflow.tech';
    const adminToken = process.env.DIRECTUS_TOKEN;
    
    if (!adminToken) {
      console.log('❌ Отсутствует DIRECTUS_TOKEN');
      return;
    }
    
    // Получаем данные пользователя напрямую
    const response = await fetch(`${directusUrl}/users?filter[email][_eq]=lbrspb@gmail.com`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    const userData = await response.json();
    
    if (userData.data && userData.data.length > 0) {
      const user = userData.data[0];
      console.log('👤 Данные пользователя из Directus:');
      console.log(`  📧 Email: ${user.email}`);
      console.log(`  🔰 is_smm_admin: ${user.is_smm_admin}`);
      console.log(`  🚀 is_smm_super: ${user.is_smm_super}`);
      console.log(`  🎭 role: ${user.role}`);
      
      const shouldBeAdmin = user.is_smm_admin === true || 
                           user.is_smm_admin === 1 || 
                           user.is_smm_admin === '1' || 
                           user.is_smm_admin === 'true';
      
      console.log(`✅ Должен быть админом: ${shouldBeAdmin}`);
    } else {
      console.log('❌ Пользователь не найден');
    }
    
  } catch (error) {
    console.error('❌ Ошибка при получении данных:', error.message);
  }
}

// Запускаем все тесты
async function runAllTests() {
  await testAdminCheck();
  await testIsUserAdminFunction();
  await testDirectusUserData();
}

runAllTests();