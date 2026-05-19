/**
 * Обновление Qwen API ключа на рабочий
 */

import axios from 'axios';

async function updateQwenWorkingKey() {
    try {
        console.log('Обновляем Qwen API ключ на рабочий...');
        
        // Рабочий API ключ, протестированный выше
        const workingApiKey = 'sk-7a1ca1ace15f4531b21bb1478457406a';
        
        // Авторизация в Directus
        const authResponse = await axios.post('https://directus.nplanner.ru/auth/login', {
            email: process.env.DIRECTUS_ADMIN_EMAIL,
            password: process.env.DIRECTUS_ADMIN_PASSWORD
        });
        
        const token = authResponse.data.data.access_token;
        console.log('✓ Авторизация в Directus успешна');
        
        // Получаем существующую запись Qwen
        const getResponse = await axios.get('https://directus.nplanner.ru/items/global_api_keys', {
            headers: { Authorization: `Bearer ${token}` },
            params: { 'filter[service][_eq]': 'qwen' }
        });
        
        if (getResponse.data.data.length > 0) {
            const qwenRecord = getResponse.data.data[0];
            
            // Обновляем существующую запись
            await axios.patch(`https://directus.nplanner.ru/items/global_api_keys/${qwenRecord.id}`, {
                api_key: workingApiKey,
                is_active: true
            }, {
                headers: { Authorization: `Bearer ${token}` }
            });
            
            console.log('✓ Qwen API ключ успешно обновлен');
        } else {
            // Создаем новую запись
            await axios.post('https://directus.nplanner.ru/items/global_api_keys', {
                service: 'qwen',
                api_key: workingApiKey,
                is_active: true
            }, {
                headers: { Authorization: `Bearer ${token}` }
            });
            
            console.log('✓ Новая запись Qwen API ключа создана');
        }
        
        // Тестируем через наш API
        console.log('Тестируем обновленный API...');
        const testResponse = await axios.post('http://localhost:5000/api/qwen/improve-text', {
            text: 'Короткий тест',
            prompt: 'Расширь и улучши',
            model: 'qwen2.5-72b-instruct'
        });
        
        if (testResponse.data.success) {
            console.log('✅ Qwen API работает через систему!');
            console.log('Результат:', testResponse.data.result.substring(0, 100) + '...');
        } else {
            console.log('❌ Ошибка тестирования:', testResponse.data.error);
        }
        
    } catch (error) {
        console.error('Ошибка обновления Qwen ключа:', error.response?.data || error.message);
    }
}

updateQwenWorkingKey();