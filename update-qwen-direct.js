/**
 * Прямое обновление Qwen API ключа в Global API Keys
 */
import axios from 'axios';

async function updateQwenDirect() {
  try {
    console.log('Получаем текущий Qwen ключ из Global API Keys...');
    
    // Получаем все ключи без авторизации (публичный endpoint)
    const response = await axios.get('http://localhost:5000/api/global-api-keys');
    const keys = response.data;
    
    console.log(`Найдено ${keys.length} глобальных ключей`);
    
    const qwenKey = keys.find(key => key.service_name === 'qwen');
    
    if (qwenKey) {
      console.log(`Текущий Qwen ключ: ${qwenKey.api_key}`);
      console.log(`ID ключа: ${qwenKey.id}`);
      
      // Получаем новый ключ из переменной окружения
      const newKey = process.env.QWEN_API_KEY;
      console.log(`Новый ключ из env: ${newKey}`);
      
      if (newKey && newKey !== qwenKey.api_key) {
        console.log('Ключи отличаются, требуется обновление');
        
        // Для обновления нужна авторизация
        console.log('Для обновления ключа требуется авторизация через веб-интерфейс');
        console.log('Проверим работу нового ключа напрямую...');
        
        // Тестируем новый ключ напрямую с DashScope API
        const testResponse = await axios.post('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
          model: 'qwen2.5-72b-instruct',
          messages: [
            {
              role: 'user',
              content: 'Привет'
            }
          ],
          max_tokens: 100
        }, {
          headers: {
            'Authorization': `Bearer ${newKey}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (testResponse.status === 200) {
          console.log('✓ Новый Qwen API ключ работает корректно');
          console.log('Ответ:', testResponse.data.choices[0].message.content);
        }
        
      } else {
        console.log('Ключи одинаковые или новый ключ не найден');
      }
      
    } else {
      console.log('Qwen ключ не найден в Global API Keys');
    }
    
  } catch (error) {
    if (error.response?.status === 401) {
      console.log('✗ API ключ недействителен для Alibaba Cloud DashScope');
      console.log('Нужен корректный ключ от https://dashscope.console.aliyun.com/');
    } else {
      console.error('Ошибка:', error.response?.data || error.message);
    }
  }
}

updateQwenDirect();