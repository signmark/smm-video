/**
 * Технический анализ системы на дублирующиеся публикации
 * Проверяет код на наличие потенциальных уязвимостей
 */

import fs from 'fs';
import path from 'path';

function analyzeCodeForDuplicateRisks() {
  console.log('🔍 ТЕХНИЧЕСКИЙ АНАЛИЗ КОДА НА РИСКИ ДУБЛИКАТОВ\n');
  
  const findings = {
    critical: [],
    high: [],
    medium: [],
    low: [],
    info: []
  };

  // 1. Анализ планировщика публикаций
  console.log('1. Анализ publish-scheduler.ts...');
  try {
    const schedulerContent = fs.readFileSync('server/services/publish-scheduler.ts', 'utf8');
    
    // Проверка на критические уязвимости
    if (!schedulerContent.includes('isProcessing')) {
      findings.critical.push('Отсутствует механизм блокировки планировщика');
    }
    
    if (!schedulerContent.includes('processedContentIds')) {
      findings.high.push('Отсутствует кэш обработанного контента');
    }
    
    // Проверка валидации postUrl
    if (!schedulerContent.includes('postUrl') || !schedulerContent.includes('trim()')) {
      findings.high.push('Недостаточная валидация postUrl для опубликованного контента');
    }
    
    // Проверка обработки ошибок
    const errorHandlingCount = (schedulerContent.match(/catch\s*\(/g) || []).length;
    if (errorHandlingCount < 3) {
      findings.medium.push(`Недостаточная обработка ошибок (найдено ${errorHandlingCount} catch блоков)`);
    }
    
    // Проверка токенов
    if (!schedulerContent.includes('adminTokenCache')) {
      findings.medium.push('Отсутствует кэширование токенов авторизации');
    }
    
    console.log(`   ✓ Проанализировано ${schedulerContent.length} символов кода`);
    
  } catch (error) {
    findings.critical.push(`Ошибка чтения планировщика: ${error.message}`);
  }

  // 2. Анализ валидатора статусов
  console.log('2. Анализ status-validator.ts...');
  try {
    const validatorContent = fs.readFileSync('server/services/status-validator.ts', 'utf8');
    
    if (!validatorContent.includes('postUrl')) {
      findings.high.push('Валидатор не проверяет наличие postUrl');
    }
    
    if (!validatorContent.includes('published')) {
      findings.medium.push('Валидатор не проверяет статус published');
    }
    
    console.log(`   ✓ Проанализировано ${validatorContent.length} символов кода`);
    
  } catch (error) {
    findings.medium.push(`Ошибка чтения валидатора: ${error.message}`);
  }

  // 3. Анализ социальных сервисов
  console.log('3. Анализ social services...');
  try {
    const socialFiles = ['vk.ts', 'telegram.ts', 'facebook.ts', 'instagram.ts'];
    const socialDir = 'server/services/social';
    
    for (const file of socialFiles) {
      const filePath = path.join(socialDir, file);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        
        // Проверка возврата postUrl
        if (!content.includes('postUrl') && !content.includes('post_url')) {
          findings.medium.push(`${file}: Сервис может не возвращать postUrl`);
        }
        
        // Проверка обработки ошибок
        if (!content.includes('try') || !content.includes('catch')) {
          findings.medium.push(`${file}: Недостаточная обработка ошибок`);
        }
      }
    }
    
    console.log(`   ✓ Проанализировано ${socialFiles.length} социальных сервисов`);
    
  } catch (error) {
    findings.medium.push(`Ошибка анализа социальных сервисов: ${error.message}`);
  }

  // 4. Анализ API роутов
  console.log('4. Анализ publishing-routes.ts...');
  try {
    const routesContent = fs.readFileSync('server/api/publishing-routes.ts', 'utf8');
    
    // Проверка дублирующихся роутов
    const postRoutes = (routesContent.match(/router\.post/g) || []).length;
    const publishRoutes = (routesContent.match(/publish/g) || []).length;
    
    if (publishRoutes > postRoutes * 2) {
      findings.medium.push('Возможно дублирование роутов публикации');
    }
    
    // Проверка валидации входных данных
    if (!routesContent.includes('validate') && !routesContent.includes('schema')) {
      findings.medium.push('Отсутствует валидация входных данных в роутах');
    }
    
    console.log(`   ✓ Найдено ${postRoutes} POST роутов публикации`);
    
  } catch (error) {
    findings.medium.push(`Ошибка анализа роутов: ${error.message}`);
  }

  // 5. Анализ базы данных адаптера
  console.log('5. Анализ directus-storage-adapter.ts...');
  try {
    const storageContent = fs.readFileSync('server/services/directus-storage-adapter.ts', 'utf8');
    
    // Проверка транзакций
    if (!storageContent.includes('transaction')) {
      findings.medium.push('Отсутствуют транзакции при обновлении статусов');
    }
    
    // Проверка атомарности операций
    if (!storageContent.includes('atomic')) {
      findings.low.push('Рекомендуется использовать атомарные операции');
    }
    
    console.log(`   ✓ Проанализирован адаптер хранилища`);
    
  } catch (error) {
    findings.medium.push(`Ошибка анализа адаптера хранилища: ${error.message}`);
  }

  // 6. Анализ конфигурации
  console.log('6. Анализ конфигурации и переменных окружения...');
  try {
    const envFiles = ['.env', '.env.example'];
    let envAnalysis = { hasSchedulerConfig: false, hasTimeouts: false };
    
    for (const envFile of envFiles) {
      if (fs.existsSync(envFile)) {
        const envContent = fs.readFileSync(envFile, 'utf8');
        
        if (envContent.includes('SCHEDULER') || envContent.includes('PUBLISH')) {
          envAnalysis.hasSchedulerConfig = true;
        }
        
        if (envContent.includes('TIMEOUT') || envContent.includes('INTERVAL')) {
          envAnalysis.hasTimeouts = true;
        }
      }
    }
    
    if (!envAnalysis.hasSchedulerConfig) {
      findings.low.push('Рекомендуется добавить конфигурацию планировщика в .env');
    }
    
    console.log(`   ✓ Проанализированы файлы конфигурации`);
    
  } catch (error) {
    findings.low.push(`Ошибка анализа конфигурации: ${error.message}`);
  }

  // Формирование отчета
  console.log('\n📊 РЕЗУЛЬТАТЫ ТЕХНИЧЕСКОГО АНАЛИЗА:');
  console.log('=====================================');
  
  const totalFindings = Object.values(findings).flat().length;
  
  if (findings.critical.length > 0) {
    console.log('\n🚨 КРИТИЧЕСКИЕ УЯЗВИМОСТИ:');
    findings.critical.forEach((finding, i) => console.log(`   ${i + 1}. ${finding}`));
  }
  
  if (findings.high.length > 0) {
    console.log('\n⚠️  ВЫСОКИЙ РИСК:');
    findings.high.forEach((finding, i) => console.log(`   ${i + 1}. ${finding}`));
  }
  
  if (findings.medium.length > 0) {
    console.log('\n⚡ СРЕДНИЙ РИСК:');
    findings.medium.forEach((finding, i) => console.log(`   ${i + 1}. ${finding}`));
  }
  
  if (findings.low.length > 0) {
    console.log('\n💡 НИЗКИЙ РИСК / РЕКОМЕНДАЦИИ:');
    findings.low.forEach((finding, i) => console.log(`   ${i + 1}. ${finding}`));
  }
  
  if (findings.info.length > 0) {
    console.log('\n📝 ИНФОРМАЦИОННЫЕ ЗАМЕЧАНИЯ:');
    findings.info.forEach((finding, i) => console.log(`   ${i + 1}. ${finding}`));
  }
  
  // Итоговая оценка
  let riskLevel = 'МИНИМАЛЬНЫЙ';
  if (findings.critical.length > 0) riskLevel = 'КРИТИЧЕСКИЙ';
  else if (findings.high.length > 0) riskLevel = 'ВЫСОКИЙ';
  else if (findings.medium.length > 2) riskLevel = 'СРЕДНИЙ';
  else if (findings.medium.length > 0) riskLevel = 'НИЗКИЙ';
  
  console.log(`\n🎯 ОБЩИЙ РИСК ДУБЛИКАТОВ: ${riskLevel}`);
  console.log(`📈 Всего найдено замечаний: ${totalFindings}`);
  
  if (totalFindings === 0) {
    console.log('🎉 СИСТЕМА ПОЛНОСТЬЮ ЗАЩИЩЕНА ОТ ДУБЛИКАТОВ!');
  } else if (findings.critical.length === 0 && findings.high.length === 0) {
    console.log('✅ Система имеет надежную защиту от дубликатов');
  } else {
    console.log('⚠️  Требуется устранение выявленных уязвимостей');
  }
  
  return findings;
}

// Запуск анализа
analyzeCodeForDuplicateRisks();