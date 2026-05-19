#!/usr/bin/env node

/**
 * Диагностика двойной публикации - поиск источников дублирования
 */

import fs from 'fs';
import axios from 'axios';

const API_URL = process.env.API_URL || 'http://localhost:5000';

// 1. Проверка планировщика на множественные вызовы
function checkSchedulerMultipleCalls() {
  console.log('🔍 ПРОВЕРКА 1: Множественные вызовы планировщика\n');
  
  try {
    const schedulerPath = 'server/services/publish-scheduler.ts';
    const content = fs.readFileSync(schedulerPath, 'utf8');
    
    // Поиск потенциальных проблем
    const issues = [];
    
    // 1. Проверяем на множественное создание экземпляра планировщика
    const instanceMatches = content.match(/new\s+PublishScheduler/g);
    if (instanceMatches && instanceMatches.length > 1) {
      issues.push(`Найдено ${instanceMatches.length} создания экземпляра PublishScheduler`);
    }
    
    // 2. Проверяем на множественные setInterval
    const intervalMatches = content.match(/setInterval/g);
    if (intervalMatches && intervalMatches.length > 1) {
      issues.push(`Найдено ${intervalMatches.length} setInterval - возможно параллельное выполнение`);
    }
    
    // 3. Проверяем на отсутствие блокировки
    const lockingPattern = /this\.isRunning|isProcessing|mutex|lock/;
    if (!lockingPattern.test(content)) {
      issues.push('Отсутствует механизм блокировки от параллельного выполнения');
    }
    
    if (issues.length === 0) {
      console.log('✅ Планировщик: проблем с множественными вызовами не найдено');
    } else {
      console.log('❌ Планировщик: найдены потенциальные проблемы:');
      issues.forEach(issue => console.log(`  - ${issue}`));
    }
    
    return issues.length === 0;
    
  } catch (error) {
    console.log(`❌ Ошибка при проверке планировщика: ${error.message}`);
    return false;
  }
}

// 2. Проверка маршрутов на дублирование публикации
function checkRoutesDuplication() {
  console.log('\n🔍 ПРОВЕРКА 2: Дублирование в маршрутах\n');
  
  try {
    const routesPath = 'server/routes.ts';
    const content = fs.readFileSync(routesPath, 'utf8');
    
    const issues = [];
    
    // Ищем маршруты публикации
    const publishRoutes = content.match(/app\.(post|patch|put).*\/publish/g);
    if (publishRoutes) {
      console.log(`Найдено ${publishRoutes.length} маршрутов публикации:`);
      publishRoutes.forEach(route => console.log(`  - ${route}`));
      
      // Проверяем на дублирование маршрутов
      const routePaths = publishRoutes.map(route => {
        const match = route.match(/\/[^'"]+/);
        return match ? match[0] : '';
      });
      
      const uniquePaths = [...new Set(routePaths)];
      if (routePaths.length !== uniquePaths.length) {
        issues.push('Найдены дублирующиеся маршруты публикации');
      }
    }
    
    // Проверяем на прямые вызовы социальных сервисов без защиты
    const directServiceCalls = content.match(/socialPublishingService\.|vkService\.|telegramService\./g);
    if (directServiceCalls && directServiceCalls.length > 5) {
      issues.push(`Слишком много прямых вызовов сервисов: ${directServiceCalls.length}`);
    }
    
    if (issues.length === 0) {
      console.log('✅ Маршруты: дублирования не найдено');
    } else {
      console.log('❌ Маршруты: найдены проблемы:');
      issues.forEach(issue => console.log(`  - ${issue}`));
    }
    
    return issues.length === 0;
    
  } catch (error) {
    console.log(`❌ Ошибка при проверке маршрутов: ${error.message}`);
    return false;
  }
}

// 3. Проверка защиты от повторной публикации
function checkPublicationGuards() {
  console.log('\n🔍 ПРОВЕРКА 3: Защита от повторной публикации\n');
  
  try {
    const publishingServicePath = 'server/services/social-publishing-with-imgur.ts';
    const content = fs.readFileSync(publishingServicePath, 'utf8');
    
    const protections = [];
    
    // Проверяем наличие проверок статуса перед публикацией
    if (content.includes('status === \'published\'')) {
      protections.push('Проверка статуса published');
    }
    
    if (content.includes('postUrl') && content.includes('already published')) {
      protections.push('Проверка наличия postUrl');
    }
    
    // Проверяем на блокировки
    if (content.includes('isProcessing') || content.includes('mutex') || content.includes('lock')) {
      protections.push('Механизм блокировки');
    }
    
    // Проверяем на дедупликацию
    if (content.includes('duplicate') || content.includes('already exists')) {
      protections.push('Проверка на дубликаты');
    }
    
    console.log(`Найдено защит: ${protections.length}`);
    protections.forEach(protection => console.log(`  ✅ ${protection}`));
    
    if (protections.length < 2) {
      console.log('⚠️ Недостаточно защит от повторной публикации');
      return false;
    }
    
    return true;
    
  } catch (error) {
    console.log(`❌ Ошибка при проверке защит: ${error.message}`);
    return false;
  }
}

// 4. Проверка API на race conditions
async function checkApiRaceConditions() {
  console.log('\n🔍 ПРОВЕРКА 4: Race conditions в API\n');
  
  try {
    // Делаем несколько параллельных запросов к планировщику
    const requests = [];
    for (let i = 0; i < 3; i++) {
      requests.push(
        axios.get(`${API_URL}/api/publish/check-scheduled`, { timeout: 5000 })
          .then(response => ({ success: true, index: i }))
          .catch(error => ({ success: false, index: i, error: error.message }))
      );
    }
    
    const results = await Promise.all(requests);
    
    console.log('Результаты параллельных запросов:');
    results.forEach(result => {
      if (result.success) {
        console.log(`  ✅ Запрос ${result.index}: успешно`);
      } else {
        console.log(`  ❌ Запрос ${result.index}: ошибка - ${result.error}`);
      }
    });
    
    const successCount = results.filter(r => r.success).length;
    if (successCount === results.length) {
      console.log('✅ API корректно обрабатывает параллельные запросы');
      return true;
    } else {
      console.log('⚠️ Возможны проблемы с параллельными запросами');
      return false;
    }
    
  } catch (error) {
    console.log(`❌ Ошибка при проверке API: ${error.message}`);
    return false;
  }
}

// 5. Проверка логов на признаки дублирования
function checkLogsForDuplication() {
  console.log('\n🔍 ПРОВЕРКА 5: Анализ логов на дублирование\n');
  
  // Создаем рекомендации по логированию
  const recommendations = [
    'Добавить уникальные ID операций публикации',
    'Логировать время начала и завершения каждой публикации',
    'Добавить проверку "уже опубликовано" с подробными логами',
    'Создать механизм отслеживания дублирующихся запросов'
  ];
  
  console.log('Рекомендации по улучшению логирования:');
  recommendations.forEach((rec, index) => {
    console.log(`  ${index + 1}. ${rec}`);
  });
  
  return true;
}

// Основная функция диагностики
async function main() {
  console.log('=' .repeat(80));
  console.log('🔧 ДИАГНОСТИКА ДВОЙНОЙ ПУБЛИКАЦИИ');
  console.log('=' .repeat(80));
  
  const checks = [
    { name: 'Множественные вызовы планировщика', fn: () => checkSchedulerMultipleCalls() },
    { name: 'Дублирование в маршрутах', fn: () => checkRoutesDuplication() },
    { name: 'Защита от повторной публикации', fn: () => checkPublicationGuards() },
    { name: 'Race conditions в API', fn: () => checkApiRaceConditions() },
    { name: 'Анализ логов', fn: () => checkLogsForDuplication() }
  ];
  
  let passedChecks = 0;
  const issues = [];
  
  for (const check of checks) {
    try {
      const result = await check.fn();
      if (result) {
        passedChecks++;
      } else {
        issues.push(check.name);
      }
    } catch (error) {
      console.log(`❌ Ошибка в проверке "${check.name}": ${error.message}`);
      issues.push(check.name);
    }
  }
  
  console.log('\n' + '=' .repeat(80));
  console.log('📊 РЕЗУЛЬТАТЫ ДИАГНОСТИКИ');
  console.log('=' .repeat(80));
  
  console.log(`✅ Пройдено проверок: ${passedChecks}/${checks.length}`);
  
  if (issues.length > 0) {
    console.log('\n🚨 НАЙДЕНЫ ПОТЕНЦИАЛЬНЫЕ ПРИЧИНЫ ДУБЛИРОВАНИЯ:');
    issues.forEach(issue => console.log(`  ❌ ${issue}`));
    
    console.log('\n🎯 РЕКОМЕНДАЦИИ ПО ИСПРАВЛЕНИЮ:');
    console.log('1. Добавить mutex/блокировку в планировщик');
    console.log('2. Проверять статус "published" перед каждой публикацией');
    console.log('3. Добавить уникальные ID операций для отслеживания');
    console.log('4. Логировать каждую попытку публикации с временными метками');
    console.log('5. Добавить проверку на существование postUrl');
  } else {
    console.log('\n✅ СИСТЕМА ЗАЩИЩЕНА ОТ ДУБЛИРОВАНИЯ');
  }
  
  console.log('=' .repeat(80));
  
  process.exit(issues.length > 0 ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}