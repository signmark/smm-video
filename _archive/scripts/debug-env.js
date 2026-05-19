// Отладка переменных окружения
console.log('=== ОТЛАДКА ПЕРЕМЕННЫХ ОКРУЖЕНИЯ ===');
console.log('GOOGLE_SERVICE_ACCOUNT_KEY length:', process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.length);
console.log('GOOGLE_SERVICE_ACCOUNT_KEY первые 50 символов:', process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.substring(0, 50));
console.log('GOOGLE_SERVICE_ACCOUNT_KEY последние 50 символов:', process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.substring(process.env.GOOGLE_SERVICE_ACCOUNT_KEY.length - 50));

// Попытка парсинга
try {
  const parsed = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  console.log('✅ JSON парсинг успешен');
  console.log('Project ID:', parsed.project_id);
  console.log('Client Email:', parsed.client_email);
} catch (error) {
  console.log('❌ Ошибка парсинга JSON:', error.message);
}