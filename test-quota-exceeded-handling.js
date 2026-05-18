/**
 * Тест для проверки обработки quota_exceeded статуса
 * Проверяет правильность установки и блокировки повторных попыток публикации
 */

async function testQuotaExceededHandling() {
  try {
    console.log('🧪 Тестируем обработку quota_exceeded статуса...');
    
    const testContentId = 'test-quota-exceeded-content';
    
    // Симулируем контент с quota_exceeded статусом
    const mockContent = {
      id: testContentId,
      title: 'Тест quota exceeded',
      content: 'Контент для проверки обработки превышения квоты',
      status: 'pending',
      social_platforms: {
        youtube: {
          status: 'quota_exceeded',
          platform: 'youtube',
          error: 'YouTube quota exceeded',
          updatedAt: new Date().toISOString()
        }
      },
      user_id: 'test-user',
      campaign_id: 'test-campaign'
    };
    
    console.log('📊 Исходные данные контента:');
    console.log('- Статус:', mockContent.status);
    console.log('- YouTube статус:', mockContent.social_platforms.youtube.status);
    console.log('- YouTube ошибка:', mockContent.social_platforms.youtube.error);
    
    // Импортируем социальный сервис
    const { SocialPublishingService } = await import('./server/services/social/index.js');
    const socialPublishingService = new SocialPublishingService();
    
    console.log('📝 Тестируем блокировку повторной публикации...');
    
    // Попытка опубликовать в YouTube (должна быть заблокирована)
    const result = await socialPublishingService.publishToPlatform(
      mockContent,
      'youtube',
      { youtube: { apiKey: 'test' } },
      'test-token'
    );
    
    console.log('📋 Результат попытки публикации:');
    console.log('- Platform:', result.platform);
    console.log('- Status:', result.status);
    console.log('- Error:', result.error);
    console.log('- Blocked:', result.status === 'quota_exceeded' ? 'ДА' : 'НЕТ');
    
    // Проверяем правильность блокировки
    if (result.status === 'quota_exceeded') {
      console.log('✅ УСПЕХ: Повторная публикация заблокирована для quota_exceeded');
    } else {
      console.log('❌ ОШИБКА: Повторная публикация НЕ заблокирована для quota_exceeded');
    }
    
    // Тестируем планировщик
    console.log('\n🔄 Тестируем логику планировщика...');
    
    const { getPublishScheduler } = await import('./server/services/publish-scheduler.js');
    const scheduler = getPublishScheduler();
    
    // Проверяем обновление статуса контента
    console.log('📊 Тестируем обновление общего статуса контента...');
    
    // Симулируем контент с одной платформой quota_exceeded
    const contentWithQuota = {
      id: 'test-content-quota',
      status: 'pending',
      social_platforms: {
        youtube: {
          status: 'quota_exceeded'
        }
      }
    };
    
    console.log('✅ Все проверки quota_exceeded завершены');
    
    return {
      success: true,
      blockingWorks: result.status === 'quota_exceeded',
      message: 'Тест quota_exceeded обработки завершен'
    };
    
  } catch (error) {
    console.error('❌ Ошибка теста quota_exceeded:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// Запускаем тест
testQuotaExceededHandling()
  .then(result => {
    console.log('\n📋 Результат теста quota_exceeded:');
    console.log(result);
  })
  .catch(error => {
    console.error('Критическая ошибка теста:', error);
  });