/**
 * Тест для проверки что при публикации все платформы записываются с pending статусом
 */

import axios from 'axios';

async function testPendingStatus() {
    try {
        console.log('🧪 Тестируем запись pending статуса для всех платформ при публикации...');
        
        // Тестовые данные для публикации - используем реальный контент из системы
        const testContentId = '002599a7-5c88-4de0-990e-304982bfa4fc'; // Реальный контент из базы
        const testPlatforms = {
            vk: { content: "Тестовый пост для VK" },
            telegram: { content: "Тестовый пост для Telegram" }
        };

        console.log(`📤 Отправляем запрос публикации для контента: ${testContentId}`);
        console.log(`📱 Выбранные платформы: ${Object.keys(testPlatforms).join(', ')}`);

        // Получаем токен (нужен реальный токен пользователя)
        const token = process.env.DIRECTUS_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN;
        if (!token) {
            throw new Error('Отсутствует токен для тестирования');
        }

        // Отправляем запрос на публикацию
        const response = await axios.post(`http://localhost:5000/api/content/${testContentId}/adapt`, {
            socialPlatforms: testPlatforms
        }, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        console.log('✅ Запрос публикации отправлен успешно');
        console.log('📊 Статус ответа:', response.status);

        // Проверяем результат в базе данных
        console.log('\n🔍 Проверяем статус платформ в базе данных...');
        
        const contentResponse = await axios.get(`http://localhost:5000/api/campaign-content/${testContentId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const content = contentResponse.data.data;
        const socialPlatforms = content.social_platforms || {};

        console.log('\n📋 Результаты проверки:');
        console.log('=' * 50);
        
        let allPending = true;
        
        Object.keys(testPlatforms).forEach(platform => {
            const platformData = socialPlatforms[platform];
            const status = platformData?.status || 'НЕТ ДАННЫХ';
            const hasPending = status === 'pending';
            
            console.log(`📱 ${platform.toUpperCase()}: ${status} ${hasPending ? '✅' : '❌'}`);
            
            if (!hasPending) {
                allPending = false;
            }
        });

        console.log('=' * 50);
        
        if (allPending) {
            console.log('🎉 ТЕСТ ПРОЙДЕН: Все платформы имеют pending статус!');
        } else {
            console.log('❌ ТЕСТ НЕ ПРОЙДЕН: Не все платформы имеют pending статус');
        }

        console.log('\n📄 Полные данные social_platforms:');
        console.log(JSON.stringify(socialPlatforms, null, 2));

    } catch (error) {
        console.error('❌ Ошибка при тестировании:', error.response?.data || error.message);
        
        if (error.response?.status === 404) {
            console.log('💡 Контент не найден - это нормально для тестирования');
        }
    }
}

testPendingStatus();