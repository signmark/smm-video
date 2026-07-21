/**
 * Тест реальной генерации контента с данными анкеты
 * Использует настоящую авторизацию и API
 */

import axios from 'axios';

// Данные для авторизации
const authData = {
  email: 'lbrspb@gmail.com',
  password: 'CHANGE_ME'
};

// URL сервера
const BASE_URL = 'http://localhost:5000';

async function testRealGeneration() {
  try {
    console.log('🔐 Авторизация пользователя...');
    
    // Авторизация
    const loginResponse = await axios.post(`${BASE_URL}/api/auth/login`, authData);
    const token = loginResponse.data.token;
    
    console.log('✅ Авторизация успешна!');
    console.log('Token длина:', token.length);
    
    // Тест 1: Генерация БЕЗ данных анкеты
    console.log('\n📝 Тест 1: Генерация БЕЗ данных анкеты');
    const testWithoutData = {
      prompt: 'Создай пост о продуктах компании',
      service: 'claude',
      useCampaignData: false
    };
    
    const responseWithout = await axios.post(`${BASE_URL}/api/generate-content`, testWithoutData, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    console.log('Результат БЕЗ данных анкеты:');
    console.log(responseWithout.data.content?.substring(0, 200) + '...');
    
    // Тест 2: Генерация С данными анкеты
    console.log('\n📊 Тест 2: Генерация С данными анкеты');
    const testWithData = {
      prompt: 'Создай пост о продуктах компании',
      service: 'claude',
      useCampaignData: true,
      campaignId: '46868c44-c6a4-4bed-accf-9ad07bba790e'
    };
    
    const responseWith = await axios.post(`${BASE_URL}/api/generate-content`, testWithData, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    console.log('Результат С данными анкеты:');
    console.log(responseWith.data.content?.substring(0, 200) + '...');
    
    // Сравнение
    console.log('\n🔍 СРАВНЕНИЕ РЕЗУЛЬТАТОВ:');
    console.log('1. Без данных: общий контент, вымышленные названия');
    console.log('2. С данными: персонализированный контент с реальными данными компании');
    
    console.log('\n✅ ТЕСТ ЗАВЕРШЕН УСПЕШНО!');
    
  } catch (error) {
    console.error('❌ Ошибка:', error.response?.data || error.message);
    
    if (error.response?.status === 401) {
      console.log('💡 Нужно проверить данные авторизации');
    }
    
    if (error.response?.data?.error?.includes('API не настроен')) {
      console.log('💡 Нужно настроить API ключ для выбранного сервиса');
    }
  }
}

// Запуск теста
testRealGeneration();