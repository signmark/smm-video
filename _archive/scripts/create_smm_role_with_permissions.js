/**
 * Script to create SMM Manager User role with exact permissions from screenshot
 */

import axios from 'axios';

const DIRECTUS_URL = 'https://directus.roboflow.tech';

async function createSMMRoleWithPermissions() {
  try {
    console.log('Creating SMM Manager User role with specific permissions...');
    
    // First authenticate with admin credentials
    const authResponse = await axios.post(`${DIRECTUS_URL}/auth/login`, {
      email: 'admin@roboflow.tech',
      password: 'Qtp23dh7'
    });
    
    const adminToken = authResponse.data.data.access_token;
    console.log('Successfully authenticated as admin');

    const headers = {
      'Authorization': `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    };

    // First, create the role
    const roleData = {
      name: 'SMM Manager User',
      icon: 'person',
      description: 'Обычный пользователь SMM системы с базовыми правами',
      admin_access: false,
      app_access: true
    };

    let roleId;
    try {
      const roleResponse = await axios.post(`${DIRECTUS_URL}/roles`, roleData, { headers });
      roleId = roleResponse.data.data.id;
      console.log(`Role created with ID: ${roleId}`);
    } catch (error) {
      if (error.response?.status === 400 && error.response.data.errors?.[0]?.message?.includes('unique')) {
        // Role already exists, get its ID
        const existingRoles = await axios.get(`${DIRECTUS_URL}/roles?filter[name][_eq]=SMM Manager User`, { headers });
        if (existingRoles.data.data.length > 0) {
          roleId = existingRoles.data.data[0].id;
          console.log(`Role already exists with ID: ${roleId}`);
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }

    // Define permissions based on the screenshot
    const permissions = [
      // business_questionnaire - all permissions
      { collection: 'business_questionnaire', action: 'create', role: roleId },
      { collection: 'business_questionnaire', action: 'read', role: roleId },
      { collection: 'business_questionnaire', action: 'update', role: roleId },
      { collection: 'business_questionnaire', action: 'delete', role: roleId },
      { collection: 'business_questionnaire', action: 'share', role: roleId },

      // campaign_content - all permissions
      { collection: 'campaign_content', action: 'create', role: roleId },
      { collection: 'campaign_content', action: 'read', role: roleId },
      { collection: 'campaign_content', action: 'update', role: roleId },
      { collection: 'campaign_content', action: 'delete', role: roleId },
      { collection: 'campaign_content', action: 'share', role: roleId },

      // campaign_content_sources - all permissions
      { collection: 'campaign_content_sources', action: 'create', role: roleId },
      { collection: 'campaign_content_sources', action: 'read', role: roleId },
      { collection: 'campaign_content_sources', action: 'update', role: roleId },
      { collection: 'campaign_content_sources', action: 'delete', role: roleId },
      { collection: 'campaign_content_sources', action: 'share', role: roleId },

      // campaign_keywords - all permissions
      { collection: 'campaign_keywords', action: 'create', role: roleId },
      { collection: 'campaign_keywords', action: 'read', role: roleId },
      { collection: 'campaign_keywords', action: 'update', role: roleId },
      { collection: 'campaign_keywords', action: 'delete', role: roleId },
      { collection: 'campaign_keywords', action: 'share', role: roleId },

      // campaign_trend_topics - all permissions
      { collection: 'campaign_trend_topics', action: 'create', role: roleId },
      { collection: 'campaign_trend_topics', action: 'read', role: roleId },
      { collection: 'campaign_trend_topics', action: 'update', role: roleId },
      { collection: 'campaign_trend_topics', action: 'delete', role: roleId },
      { collection: 'campaign_trend_topics', action: 'share', role: roleId },

      // post_comment - all permissions
      { collection: 'post_comment', action: 'create', role: roleId },
      { collection: 'post_comment', action: 'read', role: roleId },
      { collection: 'post_comment', action: 'update', role: roleId },
      { collection: 'post_comment', action: 'delete', role: roleId },
      { collection: 'post_comment', action: 'share', role: roleId },

      // source_posts - all permissions
      { collection: 'source_posts', action: 'create', role: roleId },
      { collection: 'source_posts', action: 'read', role: roleId },
      { collection: 'source_posts', action: 'update', role: roleId },
      { collection: 'source_posts', action: 'delete', role: roleId },
      { collection: 'source_posts', action: 'share', role: roleId },

      // user_api_keys - all permissions
      { collection: 'user_api_keys', action: 'create', role: roleId },
      { collection: 'user_api_keys', action: 'read', role: roleId },
      { collection: 'user_api_keys', action: 'update', role: roleId },
      { collection: 'user_api_keys', action: 'delete', role: roleId },
      { collection: 'user_api_keys', action: 'share', role: roleId },

      // user_campaigns - all permissions
      { collection: 'user_campaigns', action: 'create', role: roleId },
      { collection: 'user_campaigns', action: 'read', role: roleId },
      { collection: 'user_campaigns', action: 'update', role: roleId },
      { collection: 'user_campaigns', action: 'delete', role: roleId },
      { collection: 'user_campaigns', action: 'share', role: roleId },

      // user_keywords_user_campaigns - all permissions
      { collection: 'user_keywords_user_campaigns', action: 'create', role: roleId },
      { collection: 'user_keywords_user_campaigns', action: 'read', role: roleId },
      { collection: 'user_keywords_user_campaigns', action: 'update', role: roleId },
      { collection: 'user_keywords_user_campaigns', action: 'delete', role: roleId },
      { collection: 'user_keywords_user_campaigns', action: 'share', role: roleId },

      // Directus system collections - read only
      { collection: 'directus_activity', action: 'read', role: roleId },
      { collection: 'directus_collections', action: 'read', role: roleId },
      { collection: 'directus_comments', action: 'read', role: roleId },
      { collection: 'directus_fields', action: 'read', role: roleId },
      { collection: 'directus_notifications', action: 'read', role: roleId },
      { collection: 'directus_presets', action: 'read', role: roleId },
      { collection: 'directus_relations', action: 'read', role: roleId },
      { collection: 'directus_roles', action: 'read', role: roleId },
      { collection: 'directus_settings', action: 'read', role: roleId },
      { collection: 'directus_shares', action: 'read', role: roleId },
      { collection: 'directus_translations', action: 'read', role: roleId },
      { collection: 'directus_users', action: 'read', role: roleId },
    ];

    // Create permissions
    console.log(`Creating ${permissions.length} permissions...`);
    let successCount = 0;

    for (const permission of permissions) {
      try {
        await axios.post(`${DIRECTUS_URL}/permissions`, permission, { headers });
        successCount++;
      } catch (error) {
        if (error.response?.status === 400 && error.response.data.errors?.[0]?.message?.includes('unique')) {
          // Permission already exists
          successCount++;
        } else {
          console.log(`Failed to create permission for ${permission.collection}:${permission.action}:`, error.response?.data?.errors?.[0]?.message);
        }
      }
    }

    console.log(`Successfully created/verified ${successCount} out of ${permissions.length} permissions`);
    console.log(`SMM Manager User role setup complete with ID: ${roleId}`);

    return roleId;
  } catch (error) {
    console.error('Error creating SMM role:', error.response?.data || error.message);
    throw error;
  }
}

// Run the function
createSMMRoleWithPermissions().catch(console.error);