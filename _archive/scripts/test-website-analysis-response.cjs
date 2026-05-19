/**
 * Тест ответа API анализа сайта
 */

const axios = require('axios');

async function testWebsiteAnalysisResponse() {
  console.log('🧪 Тестирование ответа API анализа сайта...');
  
  try {
    // Для тестирования используем DIRECTUS_TOKEN
    const token = process.env.DIRECTUS_TOKEN;
    
    if (!token) {
      console.log('❌ DIRECTUS_TOKEN не найден в переменных окружения');
      return;
    }
    
    console.log('📡 Отправляем запрос на анализ сайта...');
    
    const response = await axios.post('http://localhost:5000/api/website-analysis', {
      url: 'https://www.cybersport.ru/tournaments/cs2/blast-tv-major-2025',
      campaignId: '8e4a1018-72ff-48eb-a3ff-9bd41bf83253'
    }, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });
    
    console.log('✅ Получен ответ от API');
    console.log('📊 Статус:', response.status);
    console.log('📋 Структура ответа:', JSON.stringify(response.data, null, 2));
    
    if (response.data && response.data.data) {
      const analysisData = response.data.data;
      console.log('\n🔍 Анализ полученных данных:');
      
      const fields = [
        'companyName',
        'contactInfo', 
        'businessDescription',
        'mainDirections',
        'brandImage',
        'productsServices',
        'targetAudience',
        'customerResults',
        'companyFeatures',
        'businessValues',
        'productBeliefs',
        'competitiveAdvantages',
        'marketingExpectations'
      ];
      
      fields.forEach(field => {
        const value = analysisData[field];
        if (value && value.trim()) {
          console.log(`✅ ${field}: "${value.substring(0, 100)}${value.length > 100 ? '...' : ''}"`);
        } else {
          console.log(`❌ ${field}: пустое или отсутствует`);
        }
      });
      
      console.log('\n📈 Результат:');
      const filledFields = fields.filter(field => analysisData[field] && analysisData[field].trim()).length;
      console.log(`Заполнено полей: ${filledFields} из ${fields.length}`);
      
      if (filledFields > 0) {
        console.log('🎉 AI успешно извлёк данные из сайта!');
      } else {
        console.log('⚠️ AI не смог извлечь данные из сайта');
      }
    }
    
  } catch (error) {
    console.error('❌ Ошибка тестирования:', error.response?.data || error.message);
  }
}

testWebsiteAnalysisResponse();