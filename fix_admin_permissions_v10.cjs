/**
 * Script to fix admin permissions for user creation using Directus v10+ permission structure
 */

const axios = require('axios');

const DIRECTUS_URL = 'https://directus.roboflow.tech';
const LOCAL_API_URL = 'http://localhost:5000';

/**
 * Gets the working admin token from the system
 */
async function getWorkingAdminToken() {
  try {
    console.log('Getting working admin token from system...');
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
 * Gets the current admin user info
 */
async function getCurrentAdminInfo(token) {
  try {
    const response = await axios.get(`${DIRECTUS_URL}/users/me`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    return response.data.data;
  } catch (error) {
    console.error('Error getting admin info:', error.message);
    throw error;
  }
}

/**
 * Creates a policy for user management
 */
async function createUserManagementPolicy(token, adminRoleId) {
  try {
    console.log('Creating user management policy...');
    
    const policyData = {
      name: 'User Management Policy',
      icon: 'person',
      description: 'Allows full user management including creation, reading, updating, and deletion of users',
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

    console.log('User management policy created successfully');
    return response.data.data.id;
  } catch (error) {
    if (error.response?.status === 400 && error.response?.data?.errors?.[0]?.extensions?.code === 'RECORD_NOT_UNIQUE') {
      console.log('Policy already exists, fetching existing policy...');
      
      // Try to find existing policy
      const existingResponse = await axios.get(`${DIRECTUS_URL}/policies?filter[name][_eq]=User Management Policy`, {
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
 * Assigns policy to admin role
 */
async function assignPolicyToRole(token, policyId, adminRoleId) {
  try {
    console.log(`Assigning policy ${policyId} to role ${adminRoleId}...`);
    
    const accessData = {
      role: adminRoleId,
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
 * Creates permission for user creation with policy
 */
async function createUserCreationPermission(token, policyId) {
  try {
    console.log(`Creating user creation permission for policy ${policyId}...`);
    
    const permissionData = {
      policy: policyId,
      collection: 'directus_users',
      action: 'create',
      permissions: {},
      validation: {},
      presets: {},
      fields: ['*']
    };

    const response = await axios.post(`${DIRECTUS_URL}/permissions`, permissionData, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('User creation permission created successfully');
    return response.data.data;
  } catch (error) {
    if (error.response?.status === 400 && error.response?.data?.errors?.[0]?.extensions?.code === 'RECORD_NOT_UNIQUE') {
      console.log('Permission already exists');
      return null;
    }
    console.error('Error creating user permission:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Creates permission for role reading with policy
 */
async function createRoleReadPermission(token, policyId) {
  try {
    console.log(`Creating role read permission for policy ${policyId}...`);
    
    const permissionData = {
      policy: policyId,
      collection: 'directus_roles',
      action: 'read',
      permissions: {},
      validation: {},
      presets: {},
      fields: ['*']
    };

    const response = await axios.post(`${DIRECTUS_URL}/permissions`, permissionData, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('Role read permission created successfully');
    return response.data.data;
  } catch (error) {
    if (error.response?.status === 400 && error.response?.data?.errors?.[0]?.extensions?.code === 'RECORD_NOT_UNIQUE') {
      console.log('Permission already exists');
      return null;
    }
    console.error('Error creating role permission:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Tests user creation with the admin token
 */
async function testUserCreation(token) {
  try {
    console.log('Testing user creation...');
    
    // Try to create a test user
    const testUserData = {
      email: 'test-registration-' + Date.now() + '@roboflow.tech',
      password: 'TestPassword123!',
      role: 'b3a6187c-8004-4d2c-91d7-417ecc0b113e', // SMM Manager User role
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
    console.error('Test user creation failed:', error.response?.data || error.message);
    return false;
  }
}

async function main() {
  try {
    console.log('Fixing admin permissions for user creation...\n');

    // Get working admin token
    const token = await getWorkingAdminToken();
    
    // Get admin info
    const adminInfo = await getCurrentAdminInfo(token);
    console.log(`Current admin: ${adminInfo.email} (ID: ${adminInfo.id})`);
    console.log(`Admin role: ${adminInfo.role}\n`);

    // Create policy and permissions
    const policyId = await createUserManagementPolicy(token, adminInfo.role);
    await assignPolicyToRole(token, policyId, adminInfo.role);
    await createUserCreationPermission(token, policyId);
    await createRoleReadPermission(token, policyId);
    
    // Test user creation
    console.log('\nTesting user creation functionality...');
    const testResult = await testUserCreation(token);
    
    if (testResult) {
      console.log('\nAdmin permissions fixed successfully!');
      console.log('User registration should now work properly.');
    } else {
      console.log('\nUser creation test failed. Additional permissions may be needed.');
    }

  } catch (error) {
    console.error('\nError fixing admin permissions:', error.message);
    process.exit(1);
  }
}

main();