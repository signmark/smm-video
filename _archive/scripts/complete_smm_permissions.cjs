/**
 * Script to complete the SMM Manager User role permissions
 */

const axios = require('axios');

const DIRECTUS_URL = 'https://directus.roboflow.tech';
const LOCAL_API_URL = 'http://localhost:5000';

/**
 * Gets the working admin token from the system
 */
async function getWorkingAdminToken() {
  try {
    const response = await axios.get(`${LOCAL_API_URL}/api/auth/system-token`);
    
    if (response.data.success && response.data.token) {
      console.log('Successfully obtained admin token');
      return response.data.token;
    }
    
    throw new Error('Failed to get admin token from system');
  } catch (error) {
    console.error('Error getting admin token:', error.message);
    throw error;
  }
}

/**
 * Creates permissions for SMM Manager role
 */
async function createPermissionsForSMMRole(token, policyId) {
  const collections = [
    'business_questionnaire',
    'campaign_content',
    'campaign_content_sources',
    'campaign_keywords',
    'campaign_trend_topics',
    'post_comment',
    'source_posts',
    'user_api_keys',
    'user_campaigns',
    'user_keywords_user_campaigns',
    'directus_users'
  ];

  const actions = ['create', 'read', 'update', 'delete'];

  let permissionCount = 0;

  for (const collection of collections) {
    for (const action of actions) {
      try {
        const permissionData = {
          policy: policyId,
          collection: collection,
          action: action,
          permissions: {},
          validation: {},
          presets: {},
          fields: ['*']
        };

        await axios.post(`${DIRECTUS_URL}/permissions`, permissionData, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        permissionCount++;
        console.log(`✓ Created ${action} permission for ${collection}`);
      } catch (error) {
        if (error.response?.status === 400 && error.response?.data?.errors?.[0]?.extensions?.code === 'RECORD_NOT_UNIQUE') {
          console.log(`- Permission ${action} for ${collection} already exists`);
          continue;
        }
        console.error(`Error creating permission for ${collection}:${action}:`, error.response?.data?.errors?.[0]?.message || error.message);
      }
    }
  }

  console.log(`\nTotal permissions created: ${permissionCount}`);
  return permissionCount;
}

/**
 * Tests user creation with SMM role
 */
async function testUserCreation(token, roleId) {
  try {
    console.log('\nTesting user creation with SMM Manager role...');
    
    const testUserData = {
      email: 'test-smm-permissions-' + Date.now() + '@roboflow.tech',
      password: 'TestPassword123!',
      role: roleId,
      status: 'active'
    };

    const response = await axios.post(`${DIRECTUS_URL}/users`, testUserData, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✓ Test user creation successful');
    console.log('User ID:', response.data.data.id);
    
    // Clean up test user
    await axios.delete(`${DIRECTUS_URL}/users/${response.data.data.id}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    console.log('✓ Test user cleaned up');
    return true;
  } catch (error) {
    console.log('✗ Test user creation failed:', error.response?.data?.errors?.[0]?.message || error.message);
    return false;
  }
}

async function main() {
  try {
    console.log('Completing SMM Manager User role permissions...\n');

    const token = await getWorkingAdminToken();
    
    // Known IDs from previous creation
    const roleId = 'c971fd93-1abc-4a40-9ab7-6cddb78e491c';
    const policyId = '7348f2e3-15a8-47ca-b65a-6f7316919a00';
    
    console.log(`Role ID: ${roleId}`);
    console.log(`Policy ID: ${policyId}\n`);
    
    // Create remaining permissions
    await createPermissionsForSMMRole(token, policyId);
    
    // Test user creation
    const testResult = await testUserCreation(token, roleId);
    
    if (testResult) {
      console.log('\n🎉 SMM Manager User role is now fully configured!');
      console.log('Registration should work correctly.');
    } else {
      console.log('\n❌ Role configuration still has issues.');
    }

  } catch (error) {
    console.error('\nError:', error.message);
    process.exit(1);
  }
}

main();