/**
 * Тест для проверки системы уведомлений о публикации
 * Создает тестовый запланированный контент для проверки WebSocket уведомлений
 */

import axios from 'axios';

async function createTestScheduledContent() {
  try {
    // Получаем токен администратора
    const authResponse = await axios.post('http://localhost:5000/api/auth/login', {
      email: 'lbrspb@gmail.com',
      password: 'admin123'
    });

    const token = authResponse.data.token;
    console.log('Токен получен успешно');

    // Создаем тестовый контент с временем публикации через 1 минуту
    const scheduledTime = new Date();
    scheduledTime.setMinutes(scheduledTime.getMinutes() + 1);

    const contentData = {
      content: "Тестовый пост для проверки уведомлений о публикации",
      campaign_id: "46868c44-c6a4-4bed-accf-9ad07bba790e",
      platform: "facebook",
      status: "scheduled",
      scheduled_at: scheduledTime.toISOString(),
      facebook_scheduled_at: scheduledTime.toISOString()
    };

    console.log('Создаем тестовый запланированный контент:', contentData);

    const response = await axios.post('http://localhost:5000/api/campaign-content', contentData, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('Тестовый контент создан:', response.data);
    console.log(`Публикация запланирована на: ${scheduledTime.toLocaleString()}`);
    console.log('Теперь ждите уведомления в UI через ~1 минуту');

  } catch (error) {
    console.error('Ошибка создания тестового контента:', error.response?.data || error.message);
  }
}

createTestScheduledContent();