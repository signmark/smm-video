/**
 * Скрипт для проверки учетных данных Instagram
 * Позволяет проверить, что токен и business_account_id корректны
 */

import * as dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

// Параметры Instagram API из переменных окружения
const INSTAGRAM_TOKEN = process.env.INSTAGRAM_TOKEN || '';
const INSTAGRAM_BUSINESS_ACCOUNT_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || '';

// Функция для логирования с меткой времени
function log(message) {
  console.log(`[${new Date().toLocaleTimeString()}] ${message}`);
}

/**
 * Проверяет корректность учетных данных Instagram
 */
async function checkInstagramCredentials() {
  log('=== ПРОВЕРКА УЧЕТНЫХ ДАННЫХ INSTAGRAM ===');
  
  // Проверка наличия токена и ID бизнес-аккаунта
  if (!INSTAGRAM_TOKEN) {
    log('❌ Отсутствует токен доступа Instagram (INSTAGRAM_TOKEN)');
    log('Токен можно получить в Facebook Developer Dashboard');
    return false;
  }
  
  if (!INSTAGRAM_BUSINESS_ACCOUNT_ID) {
    log('❌ Отсутствует ID бизнес-аккаунта Instagram (INSTAGRAM_BUSINESS_ACCOUNT_ID)');
    log('ID можно получить в Business Manager или через Graph API Explorer');
    return false;
  }
  
  log(`Token length: ${INSTAGRAM_TOKEN.length} characters`);
  log(`Business Account ID: ${INSTAGRAM_BUSINESS_ACCOUNT_ID}`);
  
  try {
    // Проверяем доступ к аккаунту Instagram
    const baseUrl = 'https://graph.facebook.com/v17.0';
    const accountUrl = `${baseUrl}/${INSTAGRAM_BUSINESS_ACCOUNT_ID}`;
    
    log(`Отправляем запрос к ${accountUrl}`);
    
    const response = await axios.get(accountUrl, {
      params: {
        fields: 'name,username,profile_picture_url,ig_id',
        access_token: INSTAGRAM_TOKEN
      }
    });
    
    // Проверяем ответ
    if (response.data && response.data.username) {
      log('✅ Успешная проверка учетных данных!');
      log(`Аккаунт: ${response.data.username} (${response.data.name})`);
      
      if (response.data.profile_picture_url) {
        log(`Фото профиля: ${response.data.profile_picture_url}`);
      }
      
      return true;
    } else {
      log('⚠️ Получен ответ, но отсутствуют данные о пользователе');
      log(`Содержимое ответа: ${JSON.stringify(response.data)}`);
      return false;
    }
  } catch (error) {
    log(`❌ ОШИБКА при проверке учетных данных: ${error.message}`);
    
    if (error.response) {
      log(`Статус ошибки: ${error.response.status}`);
      
      if (error.response.data && error.response.data.error) {
        const apiError = error.response.data.error;
        log(`Код ошибки API: ${apiError.code}`);
        log(`Сообщение: ${apiError.message}`);
        
        if (apiError.code === 190) {
          log('Причина: Недействительный токен доступа. Токен мог истечь или быть отозван');
        } else if (apiError.code === 100) {
          log('Причина: Неверный параметр или ID аккаунта');
        } else if (apiError.code === 10) {
          log('Причина: Недостаточно разрешений. Токен не имеет нужных прав доступа');
        }
      } else {
        log(`Детали ответа: ${JSON.stringify(error.response.data)}`);
      }
    }
    
    return false;
  }
}

/**
 * Основная функция
 */
async function main() {
  console.log('==========================================');
  console.log('ИНСТРУМЕНТ ДИАГНОСТИКИ INSTAGRAM API');
  console.log('==========================================');
  
  const credentialsValid = await checkInstagramCredentials();
  
  console.log('==========================================');
  console.log(`ИТОГ: Учетные данные ${credentialsValid ? 'ВАЛИДНЫ ✅' : 'НЕВАЛИДНЫ ❌'}`);
  
  if (!credentialsValid) {
    console.log('\nРЕКОМЕНДАЦИИ:');
    console.log('1. Убедитесь, что INSTAGRAM_TOKEN и INSTAGRAM_BUSINESS_ACCOUNT_ID заданы правильно');
    console.log('2. Проверьте, что токен имеет права на управление контентом Instagram');
    console.log('3. Убедитесь, что токен не истек и не был отозван');
    console.log('4. ID бизнес-аккаунта должен относиться к Instagram Business Account');
  }
  
  console.log('==========================================');
}

// Запускаем основную функцию
main().catch(error => {
  console.error('Неожиданная ошибка:', error);
  process.exit(1);
});