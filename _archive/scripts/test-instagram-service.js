/**
 * Тестовый скрипт для проверки Instagram Direct Service
 */

import InstagramDirectService from './server/services/instagram-direct.js';

async function testInstagramService() {
  console.log('🧪 Тестирую Instagram Direct Service...');
  
  const instagramService = new InstagramDirectService();
  
  // Тестовые данные
  const testOptions = {
    caption: '🚀 Тестовый пост из SMM Manager! Автоматическая публикация работает отлично! #SMM #автоматизация #Instagram #test',
    imageUrl: 'https://picsum.photos/1080/1080?random=2',
    username: 'it.zhdanov',
    password: 'QtpZ3dh70307'
  };
  
  console.log('📝 Данные для теста:', {
    caption: testOptions.caption.substring(0, 50) + '...',
    imageUrl: testOptions.imageUrl,
    username: testOptions.username
  });
  
  try {
    // Запускаем тест
    const result = await instagramService.testPublish(testOptions);
    
    console.log('📊 Результат теста:', result);
    
    if (result.success) {
      console.log('✅ ТЕСТ ПРОШЕЛ УСПЕШНО!');
      console.log('🔗 URL поста:', result.postUrl);
      console.log('📅 Время публикации:', result.publishedAt);
    } else {
      console.log('❌ ТЕСТ НЕ ПРОШЕЛ:', result.error);
    }
    
  } catch (error) {
    console.error('❌ Критическая ошибка теста:', error.message);
  }
}

// Запуск теста
testInstagramService();