import axios from 'axios';

// Тестирование публикации Stories
async function testStoriesPublication() {
  console.log('🎬 Тестирование публикации Instagram Stories...');
  
  const testData = {
    directusToken: process.env.DIRECTUS_TOKEN,
    baseUrl: 'http://localhost:5000',
    // ID одной из Stories
    storiesContentId: 'f79d7eb6-b7a5-43ec-971c-aaa2755c8cdd' // Замените на реальный ID Stories
  };

  try {
    // 1. Получаем данные Stories контента
    console.log('\n📋 Получаем данные Stories контента...');
    const contentResponse = await axios.get(
      `${testData.baseUrl}/api/campaign-content/${testData.storiesContentId}`,
      {
        headers: {
          'Authorization': `Bearer ${testData.directusToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const content = contentResponse.data.data;
    console.log(`Контент найден: ${content.title}`);
    console.log(`Тип контента: ${content.content_type}`);
    console.log(`Metadata:`, typeof content.metadata === 'string' ? JSON.parse(content.metadata) : content.metadata);
    
    // 2. Проверяем определение Stories в коде
    const isStory = content.content_type === 'story' || 
                   (content.metadata && (
                     (typeof content.metadata === 'string' && content.metadata.includes('storyType')) ||
                     (typeof content.metadata === 'object' && content.metadata.storyType)
                   ));

    console.log(`\n🎯 Логика определения Stories:`);
    console.log(`- content_type === 'story': ${content.content_type === 'story'}`);
    console.log(`- Есть storyType в metadata: ${content.metadata && (
      (typeof content.metadata === 'string' && content.metadata.includes('storyType')) ||
      (typeof content.metadata === 'object' && content.metadata.storyType)
    )}`);
    console.log(`- Итоговый результат isStory: ${isStory}`);
    
    const expectedWebhook = isStory ? 'publish-stories' : 'publish-instagram';
    console.log(`\n🔗 Ожидаемый webhook: /webhook/${expectedWebhook}`);

    // 3. Тестируем немедленную публикацию
    console.log('\n🚀 Тестируем немедленную публикацию...');
    const publishResponse = await axios.post(
      `${testData.baseUrl}/api/publish/now`,
      {
        contentId: testData.storiesContentId,
        platform: 'instagram'
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${testData.directusToken}`
        }
      }
    );
    
    console.log('✅ Ответ от API публикации:');
    console.log(JSON.stringify(publishResponse.data, null, 2));

  } catch (error) {
    console.error('❌ Ошибка при тестировании:', error.message);
    
    if (error.response) {
      console.error(`Статус: ${error.response.status}`);
      console.error(`Данные:`, error.response.data);
    }
  }
}

// Запускаем тест
testStoriesPublication().catch(console.error);