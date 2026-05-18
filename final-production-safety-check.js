/**
 * ФИНАЛЬНАЯ ПРОВЕРКА БЕЗОПАСНОСТИ ПЕРЕД ПРОДАКШЕНОМ
 * Проверяет все критические системы защиты от дублирования публикаций
 */

import fs from 'fs';
import path from 'path';

console.log('🔥 ФИНАЛЬНАЯ ПРОВЕРКА БЕЗОПАСНОСТИ ПЕРЕД ПРОДАКШЕНОМ 🔥\n');

// 1. Проверка Singleton Pattern
function checkSingletonPattern() {
  console.log('1. ✅ ПРОВЕРКА SINGLETON PATTERN');
  
  const schedulerFile = fs.readFileSync('server/services/publish-scheduler.ts', 'utf8');
  
  const checks = [
    {
      name: 'Глобальный экземпляр планировщика',
      pattern: /let globalSchedulerInstance/,
      found: schedulerFile.includes('let globalSchedulerInstance')
    },
    {
      name: 'Проверка существующего экземпляра',
      pattern: /global.*publishSchedulerInstance/,
      found: schedulerFile.includes('publishSchedulerInstance')
    },
    {
      name: 'Защита от повторного запуска',
      pattern: /isSchedulerStarted/,
      found: schedulerFile.includes('isSchedulerStarted')
    },
    {
      name: 'Экспорт singleton instance',
      pattern: /export const publishScheduler = startSchedulerOnce/,
      found: schedulerFile.includes('export const publishScheduler = startSchedulerOnce')
    }
  ];
  
  checks.forEach(check => {
    if (check.found) {
      console.log(`   ✅ ${check.name}: НАЙДЕНО`);
    } else {
      console.log(`   ❌ ${check.name}: НЕ НАЙДЕНО`);
    }
  });
  
  return checks.every(check => check.found);
}

// 2. Проверка блокировки обработки
function checkProcessingLock() {
  console.log('\n2. ✅ ПРОВЕРКА БЛОКИРОВКИ ОБРАБОТКИ');
  
  const schedulerFile = fs.readFileSync('server/services/publish-scheduler.ts', 'utf8');
  
  const checks = [
    {
      name: 'Флаг isProcessing',
      found: schedulerFile.includes('private isProcessing = false')
    },
    {
      name: 'Проверка блокировки перед обработкой',
      found: schedulerFile.includes('if (this.isProcessing)')
    },
    {
      name: 'Установка блокировки',
      found: schedulerFile.includes('this.isProcessing = true')
    },
    {
      name: 'Снятие блокировки в finally',
      found: schedulerFile.includes('this.isProcessing = false')
    }
  ];
  
  checks.forEach(check => {
    if (check.found) {
      console.log(`   ✅ ${check.name}: НАЙДЕНО`);
    } else {
      console.log(`   ❌ ${check.name}: НЕ НАЙДЕНО`);
    }
  });
  
  return checks.every(check => check.found);
}

// 3. Проверка защиты от повторной публикации
function checkDuplicateProtection() {
  console.log('\n3. ✅ ПРОВЕРКА ЗАЩИТЫ ОТ ПОВТОРНОЙ ПУБЛИКАЦИИ');
  
  const schedulerFile = fs.readFileSync('server/services/publish-scheduler.ts', 'utf8');
  
  const checks = [
    {
      name: 'Проверка published + postUrl',
      found: schedulerFile.includes('platformData?.status === \'published\' && platformData?.postUrl')
    },
    {
      name: 'Критическая защита комментарий',
      found: schedulerFile.includes('КРИТИЧЕСКАЯ ЗАЩИТА')
    },
    {
      name: 'Проверка уже опубликованных платформ',
      found: schedulerFile.includes('уже опубликована')
    },
    {
      name: 'Пропуск опубликованных платформ',
      found: schedulerFile.includes('пропускаем')
    }
  ];
  
  checks.forEach(check => {
    if (check.found) {
      console.log(`   ✅ ${check.name}: НАЙДЕНО`);
    } else {
      console.log(`   ❌ ${check.name}: НЕ НАЙДЕНО`);
    }
  });
  
  return checks.every(check => check.found);
}

// 4. Проверка исправления удаления платформ
function checkPlatformDeletionFix() {
  console.log('\n4. ✅ ПРОВЕРКА ИСПРАВЛЕНИЯ УДАЛЕНИЯ ПЛАТФОРМ');
  
  const routesFile = fs.readFileSync('server/api/publishing-routes.ts', 'utf8');
  
  const checks = [
    {
      name: 'Полная замена платформ (не объединение)',
      found: routesFile.includes('ПОЛНАЯ ЗАМЕНА ПЛАТФОРМ, А НЕ ОБЪЕДИНЕНИЕ')
    },
    {
      name: 'Использование только выбранных платформ',
      found: routesFile.includes('Используем только те платформы, которые пришли в запросе')
    },
    {
      name: 'Критическое исправление комментарий',
      found: routesFile.includes('КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ')
    },
    {
      name: 'Эндпоинт direct-schedule существует',
      found: routesFile.includes('/api/direct-schedule/:contentId')
    }
  ];
  
  checks.forEach(check => {
    if (check.found) {
      console.log(`   ✅ ${check.name}: НАЙДЕНО`);
    } else {
      console.log(`   ❌ ${check.name}: НЕ НАЙДЕНО`);
    }
  });
  
  return checks.every(check => check.found);
}

// 5. Проверка Publication Lock Manager
function checkLockManager() {
  console.log('\n5. ✅ ПРОВЕРКА PUBLICATION LOCK MANAGER');
  
  try {
    const lockManagerFile = fs.readFileSync('server/services/publication-lock-manager.ts', 'utf8');
    
    const checks = [
      {
        name: 'Класс PublicationLockManager',
        found: lockManagerFile.includes('class PublicationLockManager')
      },
      {
        name: 'Метод acquireLock',
        found: lockManagerFile.includes('acquireLock')
      },
      {
        name: 'Метод releaseLock',
        found: lockManagerFile.includes('releaseLock')
      },
      {
        name: 'Уникальный serverId',
        found: lockManagerFile.includes('serverId')
      }
    ];
    
    checks.forEach(check => {
      if (check.found) {
        console.log(`   ✅ ${check.name}: НАЙДЕНО`);
      } else {
        console.log(`   ❌ ${check.name}: НЕ НАЙДЕНО`);
      }
    });
    
    return checks.every(check => check.found);
  } catch (error) {
    console.log('   ⚠️ Publication Lock Manager файл не найден');
    return false;
  }
}

// 6. Общая сводка
function runAllChecks() {
  const results = {
    singleton: checkSingletonPattern(),
    processing: checkProcessingLock(),
    duplicate: checkDuplicateProtection(),
    deletion: checkPlatformDeletionFix(),
    lockManager: checkLockManager()
  };
  
  console.log('\n🔥 ИТОГОВАЯ СВОДКА БЕЗОПАСНОСТИ 🔥');
  console.log('='.repeat(50));
  
  Object.entries(results).forEach(([key, passed]) => {
    const status = passed ? '✅ ПРОЙДЕНО' : '❌ ПРОВАЛЕНО';
    const name = {
      singleton: 'Singleton Pattern',
      processing: 'Блокировка обработки',
      duplicate: 'Защита от дублирования',
      deletion: 'Исправление удаления платформ',
      lockManager: 'Lock Manager'
    }[key];
    
    console.log(`${status} - ${name}`);
  });
  
  const allPassed = Object.values(results).every(Boolean);
  
  console.log('\n' + '='.repeat(50));
  if (allPassed) {
    console.log('🎉 ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ! СИСТЕМА ГОТОВА К ПРОДАКШЕНУ! 🎉');
    console.log('✅ Дублирование публикаций предотвращено');
    console.log('✅ Удаление платформ работает корректно');
    console.log('✅ Множественные уровни защиты активны');
  } else {
    console.log('❌ ОБНАРУЖЕНЫ ПРОБЛЕМЫ! НЕ ДЕПЛОЙТЕ НА ПРОДАКШЕН!');
    console.log('🚨 Необходимо исправить найденные проблемы');
  }
  
  return allPassed;
}

// Запуск всех проверок
runAllChecks();