/**
 * Простой тест Instagram через HTTP запросы
 */
import axios from 'axios';
import FormData from 'form-data';

async function testInstagramLogin() {
  console.log('🧪 Тестируем Instagram логин через HTTP...');
  
  try {
    // Создаем сессию
    const session = axios.create({
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    // Получаем главную страницу Instagram
    console.log('📱 Получаем главную страницу Instagram...');
    const mainPage = await session.get('https://www.instagram.com/');
    
    console.log('✅ Главная страница загружена, статус:', mainPage.status);
    
    // Ищем CSRF токен
    const csrfMatch = mainPage.data.match(/"csrf_token":"([^"]+)"/);
    const csrfToken = csrfMatch ? csrfMatch[1] : null;
    
    if (csrfToken) {
      console.log('🔑 CSRF токен найден:', csrfToken.substring(0, 10) + '...');
      
      // Пытаемся авторизоваться
      const loginData = {
        username: 'it.zhdanov',
        password: 'QtpZ3dh70307',
        queryParams: '{}',
        optIntoOneTap: 'false'
      };
      
      console.log('🚪 Отправляем запрос авторизации...');
      
      const loginResponse = await session.post('https://www.instagram.com/accounts/login/ajax/', loginData, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-CSRFToken': csrfToken,
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': 'https://www.instagram.com/',
        }
      });
      
      console.log('📋 Ответ авторизации:', loginResponse.status);
      console.log('📄 Данные ответа:', loginResponse.data);
      
      if (loginResponse.data.authenticated) {
        console.log('✅ Авторизация успешна!');
        console.log('👤 Пользователь:', loginResponse.data.user?.username);
      } else {
        console.log('❌ Авторизация не удалась');
        console.log('🔍 Ошибка:', loginResponse.data.message || 'Неизвестная ошибка');
      }
      
    } else {
      console.log('❌ CSRF токен не найден');
    }
    
  } catch (error) {
    console.error('❌ Ошибка при тестировании Instagram:', error.message);
    
    if (error.response) {
      console.log('📊 Статус ответа:', error.response.status);
      console.log('📄 Заголовки ответа:', Object.keys(error.response.headers));
    }
  }
}

// Альтернативный подход - просто проверить доступность Instagram
async function checkInstagramAvailability() {
  console.log('🌐 Проверяем доступность Instagram...');
  
  try {
    const response = await axios.get('https://www.instagram.com/', {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    console.log('✅ Instagram доступен, статус:', response.status);
    console.log('📏 Размер страницы:', response.data.length, 'символов');
    
    // Ищем признаки страницы входа
    if (response.data.includes('loginForm') || response.data.includes('Log In')) {
      console.log('🔑 Страница входа обнаружена');
    }
    
    if (response.data.includes('Instagram')) {
      console.log('📱 Это действительно Instagram');
    }
    
  } catch (error) {
    console.error('❌ Instagram недоступен:', error.message);
  }
}

// Запускаем тесты
async function runTests() {
  console.log('🚀 Запускаем тесты Instagram...\n');
  
  await checkInstagramAvailability();
  console.log('\n' + '='.repeat(50) + '\n');
  await testInstagramLogin();
  
  console.log('\n✅ Тесты завершены');
}

runTests();