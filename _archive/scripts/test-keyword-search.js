import axios from 'axios';

async function testKeywordSearch() {
  console.log('🧪 Тестируем поиск ключевых слов с DIRECTUS_TOKEN');
  
  try {
    const response = await axios.get('http://0.0.0.0:5000/api/analyze-site/https%3A%2F%2Fnplanner.ru', {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DIRECTUS_TOKEN}`
      }
    });
    
    console.log('✅ Успех:', response.data);
  } catch (error) {
    console.log('❌ Ошибка:', error.response?.data || error.message);
  }
}

testKeywordSearch();