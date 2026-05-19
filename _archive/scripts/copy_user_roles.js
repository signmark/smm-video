/**
 * Скрипт для копирования ролей пользователей из старого Directus в новый
 */

import axios from 'axios';

const OLD_DIRECTUS_URL = 'https://directus.nplanner.ru';
const NEW_DIRECTUS_URL = 'https://directus.roboflow.tech';

// Учетные данные администратора
const ADMIN_EMAIL = 'lbrspb@gmail.com';
const ADMIN_PASSWORD = 'Qwerty123';

async function authenticateOldServer() {
  try {
    console.log('🔑 Аутентификация на старом сервере...');
    const response = await axios.post(`${OLD_DIRECTUS_URL}/auth/login`, {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD
    });
    return response.data.data.access_token;
  } catch (error) {
    console.error('❌ Ошибка аутентификации на старом сервере:', error.response?.data || error.message);
    return null;
  }
}

async function authenticateNewServer() {
  try {
    console.log('🔑 Аутентификация на новом сервере...');
    const response = await axios.post(`${NEW_DIRECTUS_URL}/auth/login`, {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD
    });
    return response.data.data.access_token;
  } catch (error) {
    console.error('❌ Ошибка аутентификации на новом сервере:', error.response?.data || error.message);
    return null;
  }
}

async function getRolesFromOldServer(token) {
  try {
    console.log('📋 Получение ролей со старого сервера...');
    const response = await axios.get(`${OLD_DIRECTUS_URL}/roles`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    return response.data.data;
  } catch (error) {
    console.error('❌ Ошибка получения ролей со старого сервера:', error.response?.data || error.message);
    return [];
  }
}

async function getRolesFromNewServer(token) {
  try {
    console.log('📋 Получение ролей с нового сервера...');
    const response = await axios.get(`${NEW_DIRECTUS_URL}/roles`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    return response.data.data;
  } catch (error) {
    console.error('❌ Ошибка получения ролей с нового сервера:', error.response?.data || error.message);
    return [];
  }
}

async function createRoleOnNewServer(token, roleData) {
  try {
    const cleanRoleData = {
      name: roleData.name,
      icon: roleData.icon,
      description: roleData.description,
      admin_access: roleData.admin_access || false,
      app_access: roleData.app_access || true
    };

    console.log(`➕ Создание роли "${roleData.name}" на новом сервере...`);
    const response = await axios.post(`${NEW_DIRECTUS_URL}/roles`, cleanRoleData, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    return response.data.data;
  } catch (error) {
    console.error(`❌ Ошибка создания роли "${roleData.name}":`, error.response?.data || error.message);
    return null;
  }
}

async function main() {
  console.log('🚀 Начинаем копирование ролей пользователей...\n');

  // Аутентификация на старом сервере
  const oldToken = await authenticateOldServer();
  if (!oldToken) {
    console.log('❌ Не удалось аутентифицироваться на старом сервере. Используем заранее определенные роли.');
    
    // Создаем стандартные роли вручную
    const standardRoles = [
      {
        name: 'SMM Manager User',
        icon: 'person',
        description: 'Обычный пользователь SMM системы с базовыми правами',
        admin_access: false,
        app_access: true
      },
      {
        name: 'SMM Admin',
        icon: 'admin_panel_settings',
        description: 'Администратор SMM системы с полными правами',
        admin_access: true,
        app_access: true
      },
      {
        name: 'Content Creator',
        icon: 'create',
        description: 'Создатель контента с правами на генерацию и редактирование',
        admin_access: false,
        app_access: true
      },
      {
        name: 'Analytics Viewer',
        icon: 'analytics',
        description: 'Просмотр аналитики и статистики',
        admin_access: false,
        app_access: true
      }
    ];

    // Аутентификация на новом сервере
    const newToken = await authenticateNewServer();
    if (!newToken) {
      console.log('❌ Не удалось аутентифицироваться на новом сервере');
      return;
    }

    // Получаем существующие роли
    const existingRoles = await getRolesFromNewServer(newToken);
    const existingRoleNames = existingRoles.map(role => role.name);

    // Создаем недостающие роли
    for (const role of standardRoles) {
      if (!existingRoleNames.includes(role.name)) {
        await createRoleOnNewServer(newToken, role);
      } else {
        console.log(`✅ Роль "${role.name}" уже существует`);
      }
    }

    console.log('\n✅ Создание стандартных ролей завершено!');
    return;
  }

  // Получаем роли со старого сервера
  const oldRoles = await getRolesFromOldServer(oldToken);
  if (oldRoles.length === 0) {
    console.log('❌ Не удалось получить роли со старого сервера');
    return;
  }

  console.log(`📊 Найдено ${oldRoles.length} ролей на старом сервере`);

  // Аутентификация на новом сервере
  const newToken = await authenticateNewServer();
  if (!newToken) {
    console.log('❌ Не удалось аутентифицироваться на новом сервере');
    return;
  }

  // Получаем существующие роли на новом сервере
  const existingRoles = await getRolesFromNewServer(newToken);
  const existingRoleNames = existingRoles.map(role => role.name);

  console.log(`📊 Найдено ${existingRoles.length} ролей на новом сервере\n`);

  // Копируем роли
  let copiedCount = 0;
  for (const role of oldRoles) {
    if (!existingRoleNames.includes(role.name)) {
      const newRole = await createRoleOnNewServer(newToken, role);
      if (newRole) {
        copiedCount++;
      }
    } else {
      console.log(`✅ Роль "${role.name}" уже существует`);
    }
  }

  console.log(`\n🎉 Копирование завершено! Скопировано ${copiedCount} ролей.`);
}

main().catch(console.error);