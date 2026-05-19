/**
 * Script to check and create user roles for registration
 */

import axios from 'axios';

const DIRECTUS_URL = 'https://directus.roboflow.tech';
const ADMIN_EMAIL = process.env.DIRECTUS_ADMIN_EMAIL || 'lbrspb@gmail.com';
const ADMIN_PASSWORD = process.env.DIRECTUS_ADMIN_PASSWORD || 'lbrspb2024';

async function authenticate() {
  try {
    const response = await axios.post(`${DIRECTUS_URL}/auth/login`, {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD
    });
    
    return response.data.data.access_token;
  } catch (error) {
    console.error('Authentication failed:', error.response?.data || error.message);
    throw error;
  }
}

async function listRoles(token) {
  try {
    const response = await axios.get(`${DIRECTUS_URL}/roles`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    console.log('Available roles:');
    response.data.data.forEach(role => {
      console.log(`- ${role.name} (ID: ${role.id})`);
    });
    
    return response.data.data;
  } catch (error) {
    console.error('Error getting roles:', error.response?.data || error.message);
    throw error;
  }
}

async function createSMMRole(token) {
  try {
    const response = await axios.post(`${DIRECTUS_URL}/roles`, {
      name: 'SMM Manager User',
      icon: 'person',
      description: 'Role for SMM users with basic access',
      ip_access: null,
      enforce_tfa: false,
      admin_access: false,
      app_access: true
    }, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    console.log('✓ Created SMM Manager User role:', response.data.data);
    return response.data.data;
  } catch (error) {
    console.error('Error creating role:', error.response?.data || error.message);
    throw error;
  }
}

async function main() {
  try {
    console.log('🔧 Checking and fixing user roles...');
    
    const token = await authenticate();
    console.log('✓ Authenticated successfully');

    const roles = await listRoles(token);
    
    // Check if SMM Manager User role exists
    const smmRole = roles.find(role => role.name === 'SMM Manager User');
    
    if (smmRole) {
      console.log('✓ SMM Manager User role already exists');
    } else {
      console.log('⚠ SMM Manager User role not found, creating...');
      await createSMMRole(token);
    }

    console.log('🎉 User roles check completed!');
    
  } catch (error) {
    console.error('❌ Role setup failed:', error.message);
    process.exit(1);
  }
}

main();