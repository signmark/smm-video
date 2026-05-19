import axios from 'axios';

async function updateClaudeKey() {
  try {
    // Получаем токен администратора
    const loginResponse = await axios.post('http://localhost:5000/api/auth/login', {
      email: 'lbrspb@gmail.com',
      password: 'lbrspb2024'
    });
    
    const token = loginResponse.data.token;
    console.log('Авторизация успешна');
    
    // Получаем список глобальных API ключей
    const keysResponse = await axios.get('http://localhost:5000/api/global-api-keys', {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    console.log('Получен список ключей:', keysResponse.data.length);
    
    // Ищем Claude ключ
    const claudeKey = keysResponse.data.find(key => key.service_name === 'claude');
    
    if (!claudeKey) {
      console.log('Claude ключ не найден, создаем новый...');
      
      // Создаем новый ключ
      const createResponse = await axios.post('http://localhost:5000/api/global-api-keys', {
        service_name: 'claude',
        api_key: process.env.CLAUDE_API_KEY,
        is_active: true
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      console.log('Создан новый Claude ключ:', createResponse.data.id);
    } else {
      console.log('Найден существующий Claude ключ:', claudeKey.id);
      
      // Обновляем существующий ключ
      const updateResponse = await axios.patch(`http://localhost:5000/api/global-api-keys/${claudeKey.id}`, {
        api_key: process.env.CLAUDE_API_KEY,
        is_active: true
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      console.log('Обновлен Claude ключ:', updateResponse.data);
    }
    
    console.log('Claude API ключ успешно обновлен');
    
  } catch (error) {
    console.error('Ошибка при обновлении Claude ключа:', error.response?.data || error.message);
  }
}

updateClaudeKey();