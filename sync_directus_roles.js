/**
 * Скрипт для синхронизации ролей в Directus после создания в базе данных
 */

import axios from 'axios';

async function syncDirectusRoles() {
  try {
    console.log('Авторизация в Directus...');
    
    // Авторизация
    const authResponse = await axios.post('https://directus.roboflow.tech/auth/login', {
      email: 'admin@roboflow.tech',
      password: 'Qtp23dh7'
    });
    
    const token = authResponse.data.data.access_token;
    console.log('Токен получен успешно');
    
    // Принудительная синхронизация схемы
    console.log('Принудительная синхронизация схемы Directus...');
    
    const schemaResponse = await axios.post(
      'https://directus.roboflow.tech/schema/snapshot',
      { force: true },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('Схема синхронизирована:', schemaResponse.status);
    
    // Проверяем роли через API
    console.log('Проверка ролей через API...');
    
    const rolesResponse = await axios.get('https://directus.roboflow.tech/roles', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    console.log('Найдено ролей:', rolesResponse.data.data.length);
    
    const smmRole = rolesResponse.data.data.find(role => role.name === 'SMM Manager User');
    if (smmRole) {
      console.log('✓ SMM Manager User роль найдена в API:', smmRole.id);
      console.log('  - Название:', smmRole.name);
      console.log('  - Описание:', smmRole.description);
      console.log('  - Admin access:', smmRole.admin_access);
      console.log('  - App access:', smmRole.app_access);
    } else {
      console.log('✗ SMM Manager User роль не найдена в API');
      console.log('Доступные роли:');
      rolesResponse.data.data.forEach(role => {
        console.log(`  - ${role.name} (${role.id})`);
      });
    }
    
    // Если роль не найдена, создаем через API
    if (!smmRole) {
      console.log('Создание роли SMM Manager User через API...');
      
      const createRoleResponse = await axios.post(
        'https://directus.roboflow.tech/roles',
        {
          id: 'b3a6187c-8004-4d2c-91d7-417ecc0b113e',
          name: 'SMM Manager User',
          description: 'Обычный пользователь SMM системы с базовыми правами',
          admin_access: false,
          app_access: true
        },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      console.log('Роль создана через API:', createRoleResponse.status);
      
      // Создаем все права доступа
      console.log('Создание прав доступа...');
      
      const permissions = [
        // Business questionnaire permissions
        { collection: 'business_questionnaire', action: 'create' },
        { collection: 'business_questionnaire', action: 'read' },
        { collection: 'business_questionnaire', action: 'update' },
        { collection: 'business_questionnaire', action: 'delete' },
        { collection: 'business_questionnaire', action: 'share' },
        
        // Campaign content permissions
        { collection: 'campaign_content', action: 'create' },
        { collection: 'campaign_content', action: 'read' },
        { collection: 'campaign_content', action: 'update' },
        { collection: 'campaign_content', action: 'delete' },
        { collection: 'campaign_content', action: 'share' },
        
        // Campaign content sources permissions
        { collection: 'campaign_content_sources', action: 'create' },
        { collection: 'campaign_content_sources', action: 'read' },
        { collection: 'campaign_content_sources', action: 'update' },
        { collection: 'campaign_content_sources', action: 'delete' },
        { collection: 'campaign_content_sources', action: 'share' },
        
        // Campaign keywords permissions
        { collection: 'campaign_keywords', action: 'create' },
        { collection: 'campaign_keywords', action: 'read' },
        { collection: 'campaign_keywords', action: 'update' },
        { collection: 'campaign_keywords', action: 'delete' },
        { collection: 'campaign_keywords', action: 'share' },
        
        // Campaign trend topics permissions
        { collection: 'campaign_trend_topics', action: 'create' },
        { collection: 'campaign_trend_topics', action: 'read' },
        { collection: 'campaign_trend_topics', action: 'update' },
        { collection: 'campaign_trend_topics', action: 'delete' },
        { collection: 'campaign_trend_topics', action: 'share' },
        
        // Post comment permissions
        { collection: 'post_comment', action: 'create' },
        { collection: 'post_comment', action: 'read' },
        { collection: 'post_comment', action: 'update' },
        { collection: 'post_comment', action: 'delete' },
        { collection: 'post_comment', action: 'share' },
        
        // Source posts permissions
        { collection: 'source_posts', action: 'create' },
        { collection: 'source_posts', action: 'read' },
        { collection: 'source_posts', action: 'update' },
        { collection: 'source_posts', action: 'delete' },
        { collection: 'source_posts', action: 'share' },
        
        // User API keys permissions
        { collection: 'user_api_keys', action: 'create' },
        { collection: 'user_api_keys', action: 'read' },
        { collection: 'user_api_keys', action: 'update' },
        { collection: 'user_api_keys', action: 'delete' },
        { collection: 'user_api_keys', action: 'share' },
        
        // User campaigns permissions
        { collection: 'user_campaigns', action: 'create' },
        { collection: 'user_campaigns', action: 'read' },
        { collection: 'user_campaigns', action: 'update' },
        { collection: 'user_campaigns', action: 'delete' },
        { collection: 'user_campaigns', action: 'share' },
        
        // User keywords user campaigns permissions
        { collection: 'user_keywords_user_campaigns', action: 'create' },
        { collection: 'user_keywords_user_campaigns', action: 'read' },
        { collection: 'user_keywords_user_campaigns', action: 'update' },
        { collection: 'user_keywords_user_campaigns', action: 'delete' },
        { collection: 'user_keywords_user_campaigns', action: 'share' },
        
        // Directus system collections - read only
        { collection: 'directus_activity', action: 'read' },
        { collection: 'directus_collections', action: 'read' },
        { collection: 'directus_comments', action: 'read' },
        { collection: 'directus_fields', action: 'read' },
        { collection: 'directus_notifications', action: 'read' },
        { collection: 'directus_presets', action: 'read' },
        { collection: 'directus_relations', action: 'read' },
        { collection: 'directus_roles', action: 'read' },
        { collection: 'directus_settings', action: 'read' },
        { collection: 'directus_shares', action: 'read' },
        { collection: 'directus_translations', action: 'read' },
        { collection: 'directus_users', action: 'read' }
      ];
      
      for (const permission of permissions) {
        try {
          await axios.post(
            'https://directus.roboflow.tech/permissions',
            {
              role: 'b3a6187c-8004-4d2c-91d7-417ecc0b113e',
              collection: permission.collection,
              action: permission.action
            },
            {
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
              }
            }
          );
          console.log(`✓ Право ${permission.collection}:${permission.action} создано`);
        } catch (error) {
          console.log(`✗ Ошибка создания права ${permission.collection}:${permission.action}:`, error.response?.data?.errors?.[0]?.message || error.message);
        }
      }
    }
    
    console.log('Синхронизация завершена успешно!');
    
  } catch (error) {
    console.error('Ошибка синхронизации:', error.response?.data || error.message);
  }
}

// Запуск
syncDirectusRoles();