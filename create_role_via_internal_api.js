/**
 * Создание роли SMM Manager User через внутренний API сервера
 */

import axios from 'axios';

async function createRoleViaInternalAPI() {
  try {
    console.log('Создание роли SMM Manager User через внутренний API...');
    
    // Используем внутренний API сервера на localhost:5000
    const response = await axios.post('http://localhost:5000/api/admin/create-smm-role', {
      // Данные для создания роли
    });
    
    console.log('Роль создана успешно:', response.data);
    
  } catch (error) {
    console.error('Ошибка создания роли:', error.response?.data || error.message);
  }
}

createRoleViaInternalAPI();