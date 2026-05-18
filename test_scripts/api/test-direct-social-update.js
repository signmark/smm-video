/**
 * Скрипт для прямого обновления social_platforms через локальный DirectusService
 * Не использует прямые вызовы к API, а использует внутренние сервисы приложения
 */

import express from 'express';
import { execSync } from 'child_process';
import fs from 'fs';
import https from 'https';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

// Настройки логгирования
const LOG_FILE = 'direct-social-update.log';
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);
  fs.appendFileSync(LOG_FILE, logMessage + '\n');
}

// Функция для получения ID случайного контента
async function getRandomContentId() {
  try {
    log('Получение случайного контента из локального API...');
    
    const response = await axios.get('http://localhost:5000/api/campaign-content?limit=5');
    if (response.data && response.data.data && response.data.data.length > 0) {
      const randomIndex = Math.floor(Math.random() * response.data.data.length);
      const contentId = response.data.data[randomIndex].id;
      log(`Выбран случайный контент с ID: ${contentId}`);
      return contentId;
    }
    
    log('Не удалось получить контент из API');
    return null;
  } catch (error) {
    log(`Ошибка при получении случайного контента: ${error.message}`);
    
    // Возвращаем фиксированный ID, если не удалось получить случайный
    const fixedId = '8186b9ef-b290-4cad-970e-c39b8afda63e';
    log(`Используем фиксированный ID: ${fixedId}`);
    return fixedId;
  }
}

// Функция для тестирования локального API сохранения URL
async function testLocalApiSaveUrl(contentId, platforms) {
  try {
    log('Тестирование локального API сохранения URL...');
    
    const testUrl = `http://localhost:5000/api/test/save-instagram-url`;
    const platform = Object.keys(platforms)[0] || 'instagram';
    const postUrl = platforms[platform]?.postUrl || `https://${platform}.com/p/test_${Date.now()}`;
    
    log(`Запрос к ${testUrl}`);
    log(`contentId: ${contentId}`);
    log(`platform: ${platform}`);
    log(`postUrl: ${postUrl}`);
    
    const response = await axios.post(testUrl, {
      contentId,
      postUrl,
      messageId: platforms[platform]?.messageId || '12345'
    });
    
    log(`Ответ API: ${JSON.stringify(response.data)}`);
    return response.data;
  } catch (error) {
    log(`Ошибка при тестировании API: ${error.message}`);
    if (error.response) {
      log(`Детали ответа: ${JSON.stringify(error.response.data)}`);
    }
    return null;
  }
}

// Функция для тестирования прямого обновления через socialPublishingWithImgurService
async function testDirectSocialUpdate(contentId, platforms) {
  try {
    log('Запуск тестового сервера для прямого вызова updatePublicationStatus...');
    
    // Создаем простой сервер, который будет напрямую вызывать наш сервис
    const app = express();
    app.use(express.json());
    
    app.post('/update-social', async (req, res) => {
      try {
        const { contentId, platform, status, postUrl, messageId } = req.body;
        
        // Выполняем скрипт для прямого вызова updatePublicationStatus
        const command = `
        const { socialPublishingWithImgurService } = require('./server/services/social-publishing-with-imgur');
        
        async function updateStatus() {
          console.log("Начало прямого обновления статуса публикации");
          
          try {
            const result = await socialPublishingWithImgurService.updatePublicationStatus(
              "${contentId}",
              "${platform}",
              {
                platform: "${platform}",
                status: "${status}",
                publishedAt: new Date(),
                postUrl: "${postUrl}",
                ${messageId ? `messageId: "${messageId}",` : ''}
              }
            );
            
            console.log("Результат обновления:", result ? "успешно" : "ошибка");
            process.exit(0);
          } catch (error) {
            console.error("Ошибка при обновлении:", error);
            process.exit(1);
          }
        }
        
        updateStatus();
        `;
        
        // Сохраняем команду во временный файл
        const tempFile = `temp-update-script-${Date.now()}.js`;
        fs.writeFileSync(tempFile, command);
        
        // Выполняем скрипт через Node.js
        try {
          const output = execSync(`node ${tempFile}`, { encoding: 'utf8' });
          log(`Результат выполнения скрипта: ${output}`);
          
          // Удаляем временный файл
          fs.unlinkSync(tempFile);
          
          res.json({ success: true, output });
        } catch (execError) {
          log(`Ошибка при выполнении скрипта: ${execError.message}`);
          log(`stdout: ${execError.stdout}`);
          log(`stderr: ${execError.stderr}`);
          
          // Удаляем временный файл даже при ошибке
          if (fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
          }
          
          res.status(500).json({ 
            success: false, 
            error: execError.message,
            stdout: execError.stdout,
            stderr: execError.stderr
          });
        }
      } catch (error) {
        log(`Общая ошибка в обработчике /update-social: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
      }
    });
    
    // Запускаем сервер на случайном порту
    const server = app.listen(0, async () => {
      const port = server.address().port;
      log(`Тестовый сервер запущен на порту ${port}`);
      
      try {
        // Отправляем запрос к нашему тестовому серверу
        const platform = Object.keys(platforms)[0] || 'instagram';
        const postUrl = platforms[platform]?.postUrl || `https://${platform}.com/p/test_${Date.now()}`;
        const messageId = platforms[platform]?.messageId;
        
        log(`Отправка запроса на обновление статуса публикации`);
        log(`contentId: ${contentId}`);
        log(`platform: ${platform}`);
        log(`postUrl: ${postUrl}`);
        
        const response = await axios.post(`http://localhost:${port}/update-social`, {
          contentId,
          platform,
          status: 'published',
          postUrl,
          messageId
        });
        
        log(`Ответ сервера: ${JSON.stringify(response.data)}`);
        
        // Останавливаем сервер
        server.close(() => {
          log('Тестовый сервер остановлен');
        });
      } catch (error) {
        log(`Ошибка при отправке запроса: ${error.message}`);
        if (error.response) {
          log(`Детали ответа: ${JSON.stringify(error.response.data)}`);
        }
        
        // Останавливаем сервер при ошибке
        server.close(() => {
          log('Тестовый сервер остановлен после ошибки');
        });
      }
    });
  } catch (error) {
    log(`Общая ошибка при тестировании прямого обновления: ${error.message}`);
    return null;
  }
}

// Основная функция
async function main() {
  try {
    log('=== НАЧАЛО ТЕСТИРОВАНИЯ ПРЯМОГО ОБНОВЛЕНИЯ SOCIAL_PLATFORMS ===');
    
    // 1. Получаем ID контента
    const contentId = process.argv[2] || await getRandomContentId();
    
    if (!contentId) {
      log('Ошибка: не удалось получить ID контента');
      process.exit(1);
    }
    
    // 2. Готовим тестовые данные платформ
    const testPlatforms = {
      instagram: {
        status: 'published',
        publishedAt: new Date().toISOString(),
        postUrl: `https://instagram.com/p/test_${Date.now()}`,
        messageId: `message_${Date.now()}`
      },
      telegram: {
        status: 'published',
        publishedAt: new Date().toISOString(),
        postUrl: `https://t.me/channel/message_${Date.now()}`,
        messageId: `${Date.now()}`
      }
    };
    
    // 3. Тестируем API
    log('\n=== ТЕСТ 1: Тестирование через API ===');
    await testLocalApiSaveUrl(contentId, testPlatforms);
    
    // 4. Тестируем прямое обновление
    log('\n=== ТЕСТ 2: Прямое тестирование updatePublicationStatus ===');
    await testDirectSocialUpdate(contentId, testPlatforms);
    
    log('\n=== ТЕСТИРОВАНИЕ ЗАВЕРШЕНО ===');
  } catch (error) {
    log(`Критическая ошибка: ${error.message}`);
    process.exit(1);
  }
}

// Запускаем скрипт
main();