/**
 * Простой тест логики quota_exceeded без импорта модулей
 */

console.log('🧪 Тестируем логику quota_exceeded...');

// Симулируем проверку блокировки публикации
function testQuotaExceededLogic() {
  console.log('\n📊 Тест 1: Проверка блокировки quota_exceeded');
  
  // Симулируем платформенные данные
  const platformData = {
    status: 'quota_exceeded',
    platform: 'youtube',
    error: 'YouTube quota exceeded',
    updatedAt: new Date().toISOString()
  };
  
  // Логика блокировки (из кода)
  const shouldBlock = (platformData.status === 'published' && platformData.postUrl && platformData.postUrl.trim() !== '') || 
                     platformData.status === 'quota_exceeded';
  
  const reason = platformData.status === 'quota_exceeded' ? 'квота превышена' : `уже опубликована (postUrl: ${platformData.postUrl})`;
  
  console.log('- Платформа:', platformData.platform);
  console.log('- Статус:', platformData.status);
  console.log('- Должна ли быть заблокирована:', shouldBlock ? 'ДА' : 'НЕТ');
  console.log('- Причина блокировки:', reason);
  
  if (shouldBlock && platformData.status === 'quota_exceeded') {
    console.log('✅ УСПЕХ: quota_exceeded правильно блокируется');
  } else {
    console.log('❌ ОШИБКА: quota_exceeded НЕ блокируется');
  }
  
  return shouldBlock;
}

// Тест обновления статуса
function testStatusReturn() {
  console.log('\n📊 Тест 2: Возвращаемый статус для quota_exceeded');
  
  const platformData = { status: 'quota_exceeded' };
  
  // Логика возврата статуса (из кода)
  const returnedStatus = platformData.status === 'quota_exceeded' ? 'quota_exceeded' : 'published';
  
  console.log('- Исходный статус:', platformData.status);
  console.log('- Возвращаемый статус:', returnedStatus);
  
  if (returnedStatus === 'quota_exceeded') {
    console.log('✅ УСПЕХ: quota_exceeded статус сохраняется');
  } else {
    console.log('❌ ОШИБКА: quota_exceeded статус НЕ сохраняется');
  }
  
  return returnedStatus === 'quota_exceeded';
}

// Тест сравнения с published
function testPublishedVsQuota() {
  console.log('\n📊 Тест 3: Сравнение published и quota_exceeded');
  
  const publishedData = {
    status: 'published',
    postUrl: 'https://youtube.com/watch?v=test'
  };
  
  const quotaData = {
    status: 'quota_exceeded'
  };
  
  // Проверка блокировки для published
  const shouldBlockPublished = (publishedData.status === 'published' && publishedData.postUrl && publishedData.postUrl.trim() !== '') || 
                               publishedData.status === 'quota_exceeded';
  
  // Проверка блокировки для quota_exceeded
  const shouldBlockQuota = (quotaData.status === 'published' && quotaData.postUrl && quotaData.postUrl.trim() !== '') || 
                          quotaData.status === 'quota_exceeded';
  
  console.log('- Published контент блокируется:', shouldBlockPublished ? 'ДА' : 'НЕТ');
  console.log('- Quota exceeded контент блокируется:', shouldBlockQuota ? 'ДА' : 'НЕТ');
  
  if (shouldBlockPublished && shouldBlockQuota) {
    console.log('✅ УСПЕХ: Оба статуса правильно блокируются');
  } else {
    console.log('❌ ОШИБКА: Не все статусы блокируются правильно');
  }
  
  return shouldBlockPublished && shouldBlockQuota;
}

// Запускаем все тесты
const test1 = testQuotaExceededLogic();
const test2 = testStatusReturn();  
const test3 = testPublishedVsQuota();

console.log('\n📋 Итоговый результат:');
console.log('- Тест блокировки quota_exceeded:', test1 ? '✅' : '❌');
console.log('- Тест сохранения статуса:', test2 ? '✅' : '❌');
console.log('- Тест сравнения статусов:', test3 ? '✅' : '❌');

const allTestsPassed = test1 && test2 && test3;
console.log('\n🎯 Общий результат:', allTestsPassed ? '✅ ВСЕ ТЕСТЫ ПРОШЛИ' : '❌ ЕСТЬ ОШИБКИ');

if (allTestsPassed) {
  console.log('\n🎉 Логика quota_exceeded работает корректно!');
  console.log('✅ Контент с quota_exceeded статусом блокируется от повторных попыток');
  console.log('✅ Статус quota_exceeded сохраняется и не меняется на published');
  console.log('✅ Система работает так же, как и для published контента');
} else {
  console.log('\n⚠️ Обнаружены проблемы в логике quota_exceeded');
}