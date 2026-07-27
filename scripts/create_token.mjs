/**
 * Скрипт для создания статического токена администратора через Directus API
 * 
 * Статические токены имеют неограниченный срок действия и идеально подходят
 * для системных операций, таких как планировщик публикаций
 * 
 * Использование:
 * node scripts/create_token.mjs EMAIL PASSWORD
 */

import dotenv from 'dotenv';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

// URL Directus API
const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_FILE = path.resolve(__dirname, '../.env');

async function createStaticToken(email, password) {
  if (!email || !password) {
    console.error('Ошибка: необходимо указать email и пароль администратора');
    console.log('Использование: node create_token.mjs EMAIL PASSWORD');
    process.exit(1);
  }

  try {
    console.log(`Шаг 1/3: Авторизация с учетными данными администратора...`);
    
    // Получаем временный токен авторизации
    const authResponse = await axios.post(`${DIRECTUS_URL}/auth/login`, {
      email,
      password
    });
    
    if (!authResponse.data?.data?.access_token) {
      console.error('Ошибка: неверный формат ответа API при авторизации');
      process.exit(1);
    }
    
    const temporaryToken = authResponse.data.data.access_token;
    console.log(`✅ Успешная авторизация`);
    
    // Создаем статический токен
    console.log(`\nШаг 2/3: Создание статического токена...`);
    
    const tokenName = `scheduler_token_${new Date().toISOString().slice(0, 10)}`;
    
    // Запрос актуальной информации о пользователе
    const userResponse = await axios.get(
      `${DIRECTUS_URL}/users/me`,
      {
        headers: {
          'Authorization': `Bearer ${temporaryToken}`
        }
      }
    );
    
    if (!userResponse.data?.data?.id) {
      console.error('Ошибка: не удалось получить информацию о пользователе');
      process.exit(1);
    }
    
    const userId = userResponse.data.data.id;
    console.log(`Получен ID пользователя: ${userId}`);
    
    // Создание статического токена
    const tokenResponse = await axios.post(
      `${DIRECTUS_URL}/users/${userId}/tokens`,
      {
        name: tokenName,
        // Не указываем срок действия токена, чтобы он был постоянным
      },
      {
        headers: {
          'Authorization': `Bearer ${temporaryToken}`
        }
      }
    );
    
    if (!tokenResponse.data?.data?.token) {
      console.error('Ошибка: неверный формат ответа API при создании токена');
      process.exit(1);
    }
    
    const staticToken = tokenResponse.data.data.token;
    console.log(`✅ Статический токен успешно создан`);
    
    // Обновляем .env файл
    // ВАЖНО: токен НЕ пишется на диск (.env). Бессрочный админ-токен на ФС —
    // это утечка при доступе к файлам/бэкапам. Оператор сам кладёт его в
    // секрет-менеджер / переменные окружения деплоя.
    console.log(`\n🎉 Токен создан.`);
    console.log(`\nСтатический токен администратора (скопируйте в секреты деплоя, НЕ коммитьте):`);
    console.log(`\nDIRECTUS_ADMIN_TOKEN="${staticToken}"`);
    console.log(`\nТокен не имеет срока действия. Он НЕ сохранён на диск — задайте`);
    console.log(`переменную окружения вручную и перезапустите приложение.`);

    return staticToken;
  } catch (error) {
    console.error('\n❌ Ошибка при создании токена:', error.message);
    
    if (error.response) {
      console.error('Детали ошибки API:');
      console.error(`Статус: ${error.response.status}`);
      console.error(`Данные:`, JSON.stringify(error.response.data, null, 2));
    }
    
    process.exit(1);
  }
}

// Получаем email и пароль из аргументов командной строки
const email = process.argv[2];
const password = process.argv[3];

// Запускаем создание токена
createStaticToken(email, password);