/**
 * Script to fix admin permissions for user creation using the working admin token
 * Uses the system-token endpoint to get a valid admin token and create proper permissions
 */

const axios = require('axios');

const DIRECTUS_URL = 'https://directus.roboflow.tech';
const LOCAL_API_URL = 'http://localhost:5000';

/**
 * Gets the working admin token from the system
 */
async function getWorkingAdminToken() {
  try {
    console.log('🔑 Getting working admin token from system...');
    const response = await axios.get(`${LOCAL_API_URL}/api/auth/system-token`);
    
    if (response.data.success && response.data.token) {
      console.log('✓ Successfully obtained admin token');
      return response.data.token;
    }
    
    throw new Error('Failed to get admin token from system');
  } catch (error) {
    console.error('✗ Error getting admin token:', error.message);
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
 * Creates permission for admin role to create users
 */
async function createUserCreationPermission(token, adminRoleId) {
  try {
    console.log(`📝 Creating user creation permission for role ${adminRoleId}...`);
    
    const permissionData = {
      role: adminRoleId,
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

    console.log('✓ User creation permission created successfully');
    return response.data.data;
  } catch (error) {
    if (error.response?.status === 400 && error.response?.data?.errors?.[0]?.extensions?.code === 'RECORD_NOT_UNIQUE') {
      console.log('ℹ Permission already exists');
      return null;
    }
    console.error('Error creating user permission:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Creates permission for admin role to read user roles
 */
async function createRoleReadPermission(token, adminRoleId) {
  try {
    console.log(`📝 Creating role read permission for role ${adminRoleId}...`);
    
    const permissionData = {
      role: adminRoleId,
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

    console.log('✓ Role read permission created successfully');
    return response.data.data;
  } catch (error) {
    if (error.response?.status === 400 && error.response?.data?.errors?.[0]?.extensions?.code === 'RECORD_NOT_UNIQUE') {
      console.log('ℹ Permission already exists');
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
    console.log('🧪 Testing user creation...');
    
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

    console.log('✓ Test user creation successful');
    
    // Delete the test user
    const testUserId = response.data.data.id;
    await axios.delete(`${DIRECTUS_URL}/users/${testUserId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    console.log('✓ Test user deleted successfully');
    return true;
  } catch (error) {
    console.error('✗ Test user creation failed:', error.response?.data || error.message);
    return false;
  }
}

async function main() {
  try {
    console.log('🚀 Fixing admin permissions for user creation...\n');

    // Get working admin token
    const token = await getWorkingAdminToken();
    
    // Get admin info
    const adminInfo = await getCurrentAdminInfo(token);
    console.log(`👤 Current admin: ${adminInfo.email} (ID: ${adminInfo.id})`);
    console.log(`🔑 Admin role: ${adminInfo.role}\n`);

    // Create permissions
    await createUserCreationPermission(token, adminInfo.role);
    await createRoleReadPermission(token, adminInfo.role);
    
    // Test user creation
    console.log('\n🧪 Testing user creation functionality...');
    const testResult = await testUserCreation(token);
    
    if (testResult) {
      console.log('\n✅ Admin permissions fixed successfully!');
      console.log('👍 User registration should now work properly.');
    } else {
      console.log('\n❌ User creation test failed. Additional permissions may be needed.');
    }

  } catch (error) {
    console.error('\n❌ Error fixing admin permissions:', error.message);
    process.exit(1);
  }
}

main();