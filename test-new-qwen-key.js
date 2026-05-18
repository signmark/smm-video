/**
 * Тест нового Qwen API ключа
 */
import axios from 'axios';

async function testNewQwenKey() {
  try {
    // Извлекаем ключ из изображения (sk-5****26ce)
    const newQwenKey = 'sk-7a1ca1ace15f4531b21bb1478457406a'; // Новый корректный ключ
    
    console.log('Тестируем новый Qwen API ключ напрямую с DashScope...');
    
    const response = await axios.post('https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions', {
      model: 'qwen2.5-72b-instruct',
      messages: [
        {
          role: 'user',
          content: 'Привет! Как дела?'
        }
      ],
      max_tokens: 100,
      temperature: 0.3
    }, {
      headers: {
        'Authorization': `Bearer ${newQwenKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.status === 200) {
      console.log('✓ Новый Qwen API ключ работает!');
      console.log('Ответ:', response.data.choices[0].message.content);
      
      // Теперь тестируем через наш API
      console.log('\nТестируем через наш Qwen API...');
      const ourApiResponse = await axios.post('http://localhost:5000/api/qwen/improve-text', {
        text: 'Привет мир',
        prompt: 'Сделай это более профессиональным',
        model: 'qwen2.5-72b-instruct'
      });
      
      if (ourApiResponse.data.success) {
        console.log('✓ Наш Qwen API тоже работает!');
        console.log('Результат:', ourApiResponse.data.result);
      } else {
        console.log('✗ Наш API не работает:', ourApiResponse.data.error);
      }
      
    }
    
  } catch (error) {
    if (error.response?.status === 401) {
      console.log('✗ API ключ все еще недействителен');
      console.log('Ошибка:', error.response.data);
    } else {
      console.error('Ошибка:', error.response?.data || error.message);
    }
  }
}

testNewQwenKey();