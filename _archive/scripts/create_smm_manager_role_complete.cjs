/**
 * Script to create the SMM Manager User role with all 62 permissions as shown in the screenshot
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
 * Creates the SMM Manager User role
 */
async function createSMMManagerRole(token) {
  try {
    console.log('Creating SMM Manager User role...');
    
    const roleData = {
      name: 'SMM Manager User',
      icon: 'supervised_user_circle',
      description: 'Role for SMM managers with comprehensive system access',
      ip_access: null,
      enforce_tfa: false,
      admin_access: false,
      app_access: true
    };

    const response = await axios.post(`${DIRECTUS_URL}/roles`, roleData, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('SMM Manager User role created successfully');
    return response.data.data.id;
  } catch (error) {
    if (error.response?.status === 400 && error.response?.data?.errors?.[0]?.extensions?.code === 'RECORD_NOT_UNIQUE') {
      console.log('Role already exists, fetching existing role...');
      
      const existingResponse = await axios.get(`${DIRECTUS_URL}/roles?filter[name][_eq]=SMM Manager User`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (existingResponse.data.data.length > 0) {
        return existingResponse.data.data[0].id;
      }
    }
    console.error('Error creating role:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Creates a policy for the SMM role
 */
async function createSMMPolicy(token) {
  try {
    console.log('Creating SMM policy...');
    
    const policyData = {
      name: 'SMM Manager Policy',
      icon: 'supervised_user_circle',
      description: 'Comprehensive policy for SMM managers',
      ip_access: null,
      enforce_tfa: false,
      admin_access: false,
      app_access: true
    };

    const response = await axios.post(`${DIRECTUS_URL}/policies`, policyData, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('SMM policy created successfully');
    return response.data.data.id;
  } catch (error) {
    if (error.response?.status === 400 && error.response?.data?.errors?.[0]?.extensions?.code === 'RECORD_NOT_UNIQUE') {
      console.log('Policy already exists, fetching existing policy...');
      
      const existingResponse = await axios.get(`${DIRECTUS_URL}/policies?filter[name][_eq]=SMM Manager Policy`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (existingResponse.data.data.length > 0) {
        return existingResponse.data.data[0].id;
      }
    }
    console.error('Error creating policy:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Assigns policy to role
 */
async function assignPolicyToRole(token, policyId, roleId) {
  try {
    console.log('Assigning policy to role...');
    
    const accessData = {
      role: roleId,
      policy: policyId
    };

    const response = await axios.post(`${DIRECTUS_URL}/access`, accessData, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('Policy assigned to role successfully');
    return response.data.data;
  } catch (error) {
    if (error.response?.status === 400 && error.response?.data?.errors?.[0]?.extensions?.code === 'RECORD_NOT_UNIQUE') {
      console.log('Policy already assigned to role');
      return null;
    }
    console.error('Error assigning policy to role:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Creates all permissions for SMM Manager role based on the screenshot
 */
async function createSMMPermissions(token, policyId) {
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
    'directus_activity',
    'directus_collections',
    'directus_comments',
    'directus_fields',
    'directus_notifications',
    'directus_presets',
    'directus_relations',
    'directus_roles',
    'directus_settings',
    'directus_shares',
    'directus_translations',
    'directus_users'
  ];

  const actions = ['create', 'read', 'update', 'delete', 'share'];

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
      } catch (error) {
        if (error.response?.status === 400 && error.response?.data?.errors?.[0]?.extensions?.code === 'RECORD_NOT_UNIQUE') {
          // Permission already exists, skip
          continue;
        }
        console.error(`Error creating permission for ${collection}:${action}:`, error.response?.data?.errors?.[0]?.message || error.message);
      }
    }
  }

  console.log(`Created ${permissionCount} permissions for SMM Manager role`);
  return permissionCount;
}

/**
 * Tests user creation with the new role
 */
async function testUserCreationWithSMMRole(token, roleId) {
  try {
    console.log('Testing user creation with SMM Manager role...');
    
    const testUserData = {
      email: 'test-smm-user-' + Date.now() + '@roboflow.tech',
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

    console.log('Test user creation successful');
    
    // Delete the test user
    const testUserId = response.data.data.id;
    await axios.delete(`${DIRECTUS_URL}/users/${testUserId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    console.log('Test user deleted successfully');
    return true;
  } catch (error) {
    console.log('Test user creation failed:', error.response?.data?.errors?.[0]?.message || error.message);
    return false;
  }
}

async function main() {
  try {
    console.log('Creating SMM Manager User role with complete permissions...\n');

    // Get working admin token
    const token = await getWorkingAdminToken();
    
    // Create SMM Manager role
    const roleId = await createSMMManagerRole(token);
    console.log(`SMM Manager User role ID: ${roleId}`);
    
    // Create policy
    const policyId = await createSMMPolicy(token);
    console.log(`SMM Manager policy ID: ${policyId}`);
    
    // Assign policy to role
    await assignPolicyToRole(token, policyId, roleId);
    
    // Create all permissions
    await createSMMPermissions(token, policyId);
    
    // Test user creation
    const testResult = await testUserCreationWithSMMRole(token, roleId);
    
    if (testResult) {
      console.log('\nSMM Manager User role created successfully!');
      console.log(`Role ID to use in registration: ${roleId}`);
      console.log('User registration should now work properly.');
    } else {
      console.log('\nRole created but user creation test failed.');
    }

  } catch (error) {
    console.error('\nError creating SMM Manager role:', error.message);
    process.exit(1);
  }
}

main();