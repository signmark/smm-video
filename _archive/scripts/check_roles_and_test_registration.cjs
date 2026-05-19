/**
 * Script to check available roles and test registration with correct role ID
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
 * Lists all available roles
 */
async function listRoles(token) {
  try {
    console.log('\nListing all available roles:');
    
    const response = await axios.get(`${DIRECTUS_URL}/roles`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const roles = response.data.data;
    console.log(`Found ${roles.length} roles:`);
    
    roles.forEach(role => {
      console.log(`- ${role.name} (ID: ${role.id})`);
      if (role.name.toLowerCase().includes('smm') || role.name.toLowerCase().includes('manager')) {
        console.log(`  *** This looks like the SMM role ***`);
      }
    });
    
    return roles;
  } catch (error) {
    console.error('Error listing roles:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Tests user creation with a specific role
 */
async function testUserCreationWithRole(token, roleId, roleName) {
  try {
    console.log(`\nTesting user creation with role: ${roleName} (${roleId})`);
    
    const testUserData = {
      email: 'test-registration-' + Date.now() + '@roboflow.tech',
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
    console.log('✗ Test user creation failed:', error.response?.data?.errors?.[0]?.message || error.message);
    return false;
  }
}

/**
 * Tests the registration endpoint directly
 */
async function testRegistrationEndpoint(roleId, roleName) {
  try {
    console.log(`\nTesting registration endpoint with role: ${roleName} (${roleId})`);
    
    const registrationData = {
      email: 'test-reg-endpoint-' + Date.now() + '@roboflow.tech',
      password: 'TestPassword123!',
      confirmPassword: 'TestPassword123!'
    };

    const response = await axios.post(`${LOCAL_API_URL}/api/auth/register`, registrationData, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('✓ Registration endpoint test successful');
    console.log('Response:', response.data);
    return true;
  } catch (error) {
    console.log('✗ Registration endpoint test failed:', error.response?.data || error.message);
    return false;
  }
}

async function main() {
  try {
    console.log('Checking roles and testing registration...\n');

    // Get working admin token
    const token = await getWorkingAdminToken();
    
    // List all roles
    const roles = await listRoles(token);
    
    // Find the SMM Manager User role
    const smmRole = roles.find(role => 
      role.name === 'SMM Manager User' || 
      role.name.toLowerCase().includes('smm')
    );
    
    if (smmRole) {
      console.log(`\nFound SMM role: ${smmRole.name} (ID: ${smmRole.id})`);
      
      // Test user creation with correct role
      const userCreationWorked = await testUserCreationWithRole(token, smmRole.id, smmRole.name);
      
      if (userCreationWorked) {
        console.log('\n✓ User creation with admin token works!');
        
        // Update the registration route with correct role ID
        console.log(`\nNote: Update registration route to use role ID: ${smmRole.id}`);
        
        // Test registration endpoint
        await testRegistrationEndpoint(smmRole.id, smmRole.name);
      }
    } else {
      console.log('\n⚠️ No SMM Manager User role found. Available roles:');
      roles.forEach(role => {
        console.log(`- ${role.name} (ID: ${role.id})`);
      });
    }

  } catch (error) {
    console.error('\nError:', error.message);
    process.exit(1);
  }
}

main();