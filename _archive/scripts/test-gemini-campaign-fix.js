/**
 * Тест Gemini с данными анкеты после исправления
 */

import axios from 'axios';

const authData = {
  email: 'lbrspb@gmail.com',
  password: 'CHANGE_ME'
};

const BASE_URL = 'http://localhost:5000';

async function testGeminiWithCampaignData() {
  try {
    console.log('🔐 Авторизация...');
    const loginResponse = await axios.post(`${BASE_URL}/api/auth/login`, authData);
    const token = loginResponse.data.token;
    console.log('✅ Авторизован!');
    
    console.log('\n🧠 Тестируем Gemini С данными анкеты...');
    const testData = {
      prompt: 'Создай пост о продуктах компании',
      service: 'gemini',
      useCampaignData: true,
      campaignId: '46868c44-c6a4-4bed-accf-9ad07bba790e'
    };
    
    const response = await axios.post(`${BASE_URL}/api/generate-content`, testData, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    console.log('✅ GEMINI РАБОТАЕТ!');
    console.log('Результат с данными анкеты:');
    console.log(response.data.content?.substring(0, 300) + '...\n');
    
    console.log('🎉 ФУНКЦИЯ ДАННЫХ АНКЕТЫ РАБОТАЕТ С GEMINI!');
    
  } catch (error) {
    console.error('❌ Ошибка Gemini:', error.response?.data || error.message);
  }
}

testGeminiWithCampaignData();