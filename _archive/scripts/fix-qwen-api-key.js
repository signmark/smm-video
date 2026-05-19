/**
 * Скрипт для обновления Qwen API ключа в Global API Keys
 */
import axios from 'axios';

async function updateQwenApiKey() {
  try {
    console.log('Проверяем новый Qwen API ключ из переменных окружения...');
    
    const newQwenKey = process.env.QWEN_API_KEY;
    if (!newQwenKey) {
      console.log('QWEN_API_KEY не найден в переменных окружения, используем значение из Global API Keys');
      // Попробуем обновить существующий ключ из Global API Keys новым правильным значением
      const correctQwenKey = 'sk-e87a9ed470f44065b49176f7606d5428'; // Новый правильный ключ
      
      try {
        // Получаем текущие Global API Keys
        const globalKeysResponse = await axios.get('http://localhost:5000/api/global-api-keys');
        const globalKeys = globalKeysResponse.data;
        
        // Находим Qwen ключ
        const qwenKey = globalKeys.find(key => key.service_name === 'qwen');
        
        if (qwenKey) {
          console.log(`Обновляем существующий Qwen ключ с ID: ${qwenKey.id}`);
          
          // Обновляем ключ новым значением
          const updateResponse = await axios.put(`http://localhost:5000/api/global-api-keys/${qwenKey.id}`, {
            api_key: correctQwenKey,
            service_name: 'qwen',
            is_active: true
          });
          
          console.log('Qwen API ключ успешно обновлен новым значением');
          
          // Тестируем новый ключ
          console.log('\nТестируем обновленный Qwen API ключ...');
          const testResponse = await axios.post('http://localhost:5000/api/qwen/improve-text', {
            text: 'Привет',
            prompt: 'Улучши этот текст',
            model: 'qwen2.5-72b-instruct'
          });
          
          if (testResponse.data.success) {
            console.log('✓ Qwen API тест с новым ключом успешен');
            console.log('Результат:', testResponse.data.result.substring(0, 100) + '...');
          } else {
            console.log('✗ Qwen API тест с новым ключом неудачен:', testResponse.data.error);
          }
          
        } else {
          console.log('Qwen ключ не найден в Global API Keys');
        }
        
      } catch (error) {
        console.error('Ошибка обновления Qwen ключа:', error.response?.data || error.message);
      }
      return;
    }
    
    console.log(`Новый Qwen API ключ: ${newQwenKey.substring(0, 10)}...${newQwenKey.substring(newQwenKey.length - 4)}`);
    
    // Получаем текущие Global API Keys
    const globalKeysResponse = await axios.get('http://localhost:5000/api/global-api-keys');
    const globalKeys = globalKeysResponse.data;
    
    console.log(`Получено ${globalKeys.length} глобальных API ключей`);
    
    // Находим Qwen ключ
    const qwenKey = globalKeys.find(key => key.service_name === 'qwen');
    
    if (qwenKey) {
      console.log(`Найден Qwen ключ с ID: ${qwenKey.id}`);
      console.log(`Текущий ключ: ${qwenKey.api_key.substring(0, 10)}...${qwenKey.api_key.substring(qwenKey.api_key.length - 4)}`);
      
      // Обновляем ключ
      const updateResponse = await axios.put(`http://localhost:5000/api/global-api-keys/${qwenKey.id}`, {
        api_key: newQwenKey,
        service_name: 'qwen',
        is_active: true
      });
      
      console.log('Qwen API ключ успешно обновлен в Global API Keys');
      console.log('Новое значение:', updateResponse.data);
      
      // Тестируем новый ключ
      console.log('\nТестируем новый Qwen API ключ...');
      const testResponse = await axios.post('http://localhost:5000/api/qwen/improve-text', {
        text: 'Тест',
        prompt: 'Улучши этот текст',
        model: 'qwen2.5-72b-instruct'
      });
      
      if (testResponse.data.success) {
        console.log('✓ Qwen API тест успешен');
        console.log('Результат:', testResponse.data.result.substring(0, 100) + '...');
      } else {
        console.log('✗ Qwen API тест неудачен:', testResponse.data.error);
      }
      
    } else {
      console.log('Qwen ключ не найден в Global API Keys, создаем новый...');
      
      const createResponse = await axios.post('http://localhost:5000/api/global-api-keys', {
        api_key: newQwenKey,
        service_name: 'qwen',
        is_active: true
      });
      
      console.log('Новый Qwen API ключ создан:', createResponse.data);
    }
    
  } catch (error) {
    console.error('Ошибка обновления Qwen API ключа:', error.response?.data || error.message);
  }
}

updateQwenApiKey();