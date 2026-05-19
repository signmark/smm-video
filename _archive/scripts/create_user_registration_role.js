/**
 * Script to create proper admin role permissions for user registration
 * Uses the existing working admin session from the system
 */

import axios from 'axios';

const DIRECTUS_URL = 'https://directus.roboflow.tech';

async function getWorkingAdminTokenFromSystem() {
  // Try to use the existing working admin token from the system
  const adminUserId = '61941d89-55c2-4def-83a3-bc8bfbd21d6f'; // admin@roboflow.tech
  
  // Make a request to our local server to get the cached admin token
  try {
    const response = await axios.get('http://localhost:5000/api/auth/system-token');
    
    if (response.data.success && response.data.token) {
      console.log('✓ Retrieved working admin token from system');
      return response.data.token;
    }
  } catch (error) {
    console.log('System token endpoint not available, trying direct approach');
  }
  
  return null;
}

async function createAdminPermissionsForUserCreation(token) {
  try {
    // Get the current admin user info
    const userResponse = await axios.get(`${DIRECTUS_URL}/users/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const adminUser = userResponse.data.data;
    console.log(`Current admin user: ${adminUser.email} (${adminUser.id})`);
    console.log(`Admin role: ${adminUser.role}`);
    
    if (!adminUser.role) {
      throw new Error('Admin user has no role assigned');
    }
    
    // Check existing permissions for the admin role
    const permissionsResponse = await axios.get(`${DIRECTUS_URL}/permissions`, {
      headers: { 'Authorization': `Bearer ${token}` },
      params: {
        'filter[role][_eq]': adminUser.role,
        'filter[collection][_eq]': 'directus_users'
      }
    });
    
    const existingPermissions = permissionsResponse.data.data;
    console.log(`Found ${existingPermissions.length} existing permissions for directus_users collection`);
    
    // Check if create permission exists
    const createPermission = existingPermissions.find(p => p.action === 'create');
    
    if (createPermission) {
      console.log('✓ Create permission already exists for directus_users');
      return true;
    }
    
    // Create the create permission
    const permissionData = {
      role: adminUser.role,
      collection: 'directus_users',
      action: 'create',
      permissions: {},
      validation: {},
      presets: {},
      fields: ['*']
    };
    
    const createResponse = await axios.post(`${DIRECTUS_URL}/permissions`, permissionData, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    console.log('✓ Created create permission for directus_users collection');
    
    // Also ensure read permission exists for user management
    const readPermission = existingPermissions.find(p => p.action === 'read');
    
    if (!readPermission) {
      const readPermissionData = {
        role: adminUser.role,
        collection: 'directus_users',
        action: 'read',
        permissions: {},
        validation: {},
        presets: {},
        fields: ['*']
      };
      
      await axios.post(`${DIRECTUS_URL}/permissions`, readPermissionData, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      console.log('✓ Created read permission for directus_users collection');
    }
    
    return true;
    
  } catch (error) {
    console.error('Error creating admin permissions:', error.response?.data || error.message);
    return false;
  }
}

async function testUserCreation(token) {
  try {
    // Test creating a user to verify permissions work
    const testUserData = {
      email: `test-permissions-${Date.now()}@example.com`,
      password: 'testpassword123',
      first_name: 'Test',
      last_name: 'User',
      role: 'b3a6187c-8004-4d2c-91d7-417ecc0b113e', // SMM Manager User role
      status: 'active'
    };
    
    const response = await axios.post(`${DIRECTUS_URL}/users`, testUserData, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    console.log('✅ Test user creation successful!');
    console.log('New user ID:', response.data.data.id);
    
    // Clean up test user
    await axios.delete(`${DIRECTUS_URL}/users/${response.data.data.id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    console.log('✓ Test user cleaned up');
    return true;
    
  } catch (error) {
    console.error('❌ Test user creation failed:', error.response?.data || error.message);
    return false;
  }
}

async function main() {
  try {
    console.log('🔧 Creating user registration role and permissions...');
    
    // Get working admin token from system
    const token = await getWorkingAdminTokenFromSystem();
    
    if (!token) {
      throw new Error('Could not retrieve working admin token from system');
    }
    
    // Create admin permissions for user creation
    const permissionsCreated = await createAdminPermissionsForUserCreation(token);
    
    if (!permissionsCreated) {
      throw new Error('Failed to create admin permissions');
    }
    
    // Test user creation
    const testSuccess = await testUserCreation(token);
    
    if (testSuccess) {
      console.log('✅ User registration system is now properly configured!');
      console.log('Registration endpoint should work correctly now.');
    } else {
      console.log('❌ User registration test failed - may need additional configuration');
    }
    
  } catch (error) {
    console.error('❌ Error setting up user registration:', error.message);
    process.exit(1);
  }
}

main();