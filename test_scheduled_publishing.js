#!/usr/bin/env node

/**
 * Скрипт для тестирования запланированных публикаций
 * Создает тестовый контент с планированием на будущее время
 */

import axios from 'axios';

const API_URL = process.env.API_URL || 'http://localhost:5000';
const TEST_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjUzOTIxZjE2LWY1MWQtNDU5MS04MGI5LThjYWE0ZmRlNGQxMyIsInJvbGUiOiIyODViZGU2OS0yZjA0LTRmM2YtOTg5Yy1mN2RmZWMzZGQ0MDUiLCJhcHBfYWNjZXNzIjp0cnVlLCJhZG1pbl9hY2Nlc3MiOnRydWUsImlhdCI6MTc0OTU2MzUzNywiZXhwIjoxNzQ5NTY0NDM3LCJpc3MiOiJkaXJlY3R1cyJ9.aGCm2GU6O87tP1n7HvSmxgPOgHyMZB5bQyClqnE-YzM';
const CAMPAIGN_ID = '46868c44-c6a4-4bed-accf-9ad07bba790e';

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

async function createScheduledContent() {
  try {
    log('Создание тестового контента с планированием...');
    
    // Планируем публикацию на 2 минуты вперед
    const scheduledTime = new Date(Date.now() + 2 * 60 * 1000);
    
    const contentData = {
      content: `Тестовая запланированная публикация на ${scheduledTime.toLocaleTimeString('ru-RU')}`,
      campaignId: CAMPAIGN_ID,
      userId: '53921f16-f51d-4591-80b9-8caa4fde4d13',
      status: 'scheduled',
      contentType: 'text',
      scheduledAt: scheduledTime.toISOString(),
      socialPlatforms: {
        vk: {
          selected: true,
          status: 'pending',
          scheduledAt: scheduledTime.toISOString()
        },
        telegram: {
          selected: true,
          status: 'pending', 
          scheduledAt: scheduledTime.toISOString()
        }
      }
    };
    
    const response = await axios.post(`${API_URL}/api/campaign-content`, contentData, {
      headers: {
        'Authorization': `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    
    const contentId = response.data.data.id;
    log(`Создан тестовый контент ID: ${contentId}`);
    log(`Запланирован на: ${scheduledTime.toISOString()}`);
    log(`Платформы: ВК, Telegram (обе в статусе pending)`);
    
    return contentId;
  } catch (error) {
    log(`Ошибка создания контента: ${error.message}`);
    if (error.response) {
      log(`Статус: ${error.response.status}, Данные: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

async function checkContentStatus(contentId) {
  try {
    const response = await axios.get(`${API_URL}/api/campaign-content/${contentId}`, {
      headers: {
        'Authorization': `Bearer ${TEST_TOKEN}`
      }
    });
    
    const content = response.data.data;
    log(`Статус контента ${contentId}: ${content.status}`);
    
    if (content.socialPlatforms) {
      for (const [platform, data] of Object.entries(content.socialPlatforms)) {
        log(`  ${platform}: статус=${data.status}, url=${data.postUrl || 'нет'}`);
      }
    }
    
    return content;
  } catch (error) {
    log(`Ошибка проверки статуса: ${error.message}`);
    return null;
  }
}

async function monitorScheduledContent(contentId) {
  log(`Мониторинг контента ${contentId}...`);
  
  for (let i = 0; i < 10; i++) {
    await new Promise(resolve => setTimeout(resolve, 30000)); // Ждем 30 секунд
    
    const content = await checkContentStatus(contentId);
    if (!content) continue;
    
    // Проверяем, были ли публикации досрочными
    const now = new Date();
    const scheduledTime = new Date(content.scheduledAt);
    const timeDiff = now.getTime() - scheduledTime.getTime();
    
    if (content.status === 'published' && timeDiff < -60000) {
      log(`⚠️  ДОСРОЧНАЯ ПУБЛИКАЦИЯ ОБНАРУЖЕНА! Опубликовано на ${Math.abs(timeDiff) / 1000} секунд раньше`);
      return false;
    }
    
    if (content.status === 'published') {
      log(`✅ Контент опубликован в срок`);
      return true;
    }
  }
  
  log(`❌ Контент не был опубликован в течение периода мониторинга`);
  return false;
}

async function main() {
  try {
    log('Начало теста запланированных публикаций');
    
    // Создаем тестовый контент
    const contentId = await createScheduledContent();
    
    // Мониторим его публикацию
    const result = await monitorScheduledContent(contentId);
    
    if (result) {
      log('✅ Тест пройден: планирование работает корректно');
    } else {
      log('❌ Тест не пройден: обнаружены проблемы с планированием');
    }
    
  } catch (error) {
    log(`Критическая ошибка: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}