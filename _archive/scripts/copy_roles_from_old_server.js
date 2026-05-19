/**
 * Script to copy roles from old server to new server
 */

import axios from 'axios';

const OLD_DIRECTUS_URL = 'https://directus.nplanner.ru';
const NEW_DIRECTUS_URL = 'https://directus.roboflow.tech';

// Admin credentials for old server
const OLD_ADMIN_EMAIL = 'lbrspb@gmail.com';
const OLD_ADMIN_PASSWORD = 'lbrspb2024';

// New server admin token
const NEW_ADMIN_TOKEN = process.env.DIRECTUS_ADMIN_TOKEN;

async function authenticateOldServer() {
  try {
    const response = await axios.post(`${OLD_DIRECTUS_URL}/auth/login`, {
      email: OLD_ADMIN_EMAIL,
      password: OLD_ADMIN_PASSWORD
    });
    
    return response.data.data.access_token;
  } catch (error) {
    console.error('Failed to authenticate with old server:', error.message);
    throw error;
  }
}

async function getRolesFromOldServer(token) {
  try {
    const response = await axios.get(`${OLD_DIRECTUS_URL}/roles`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    return response.data.data;
  } catch (error) {
    console.error('Failed to get roles from old server:', error.message);
    throw error;
  }
}

async function getRolesFromNewServer() {
  try {
    const response = await axios.get(`${NEW_DIRECTUS_URL}/roles`, {
      headers: {
        'Authorization': `Bearer ${NEW_ADMIN_TOKEN}`
      }
    });
    
    return response.data.data;
  } catch (error) {
    console.error('Failed to get roles from new server:', error.message);
    throw error;
  }
}

async function createRoleOnNewServer(roleData) {
  try {
    // Remove fields that shouldn't be copied
    const { id, users, policies, children, ...cleanRoleData } = roleData;
    
    const response = await axios.post(`${NEW_DIRECTUS_URL}/roles`, cleanRoleData, {
      headers: {
        'Authorization': `Bearer ${NEW_ADMIN_TOKEN}`
      }
    });
    
    return response.data.data;
  } catch (error) {
    console.error(`Failed to create role ${roleData.name}:`, error.response?.data || error.message);
    throw error;
  }
}

async function main() {
  try {
    console.log('🔧 Copying roles from old server to new server...');
    
    if (!NEW_ADMIN_TOKEN) {
      throw new Error('DIRECTUS_ADMIN_TOKEN not found in environment variables');
    }
    
    // Authenticate with old server
    console.log('Authenticating with old server...');
    const oldToken = await authenticateOldServer();
    console.log('✓ Authenticated with old server');
    
    // Get roles from both servers
    console.log('Getting roles from old server...');
    const oldRoles = await getRolesFromOldServer(oldToken);
    console.log(`Found ${oldRoles.length} roles on old server`);
    
    console.log('Getting roles from new server...');
    const newRoles = await getRolesFromNewServer();
    console.log(`Found ${newRoles.length} roles on new server`);
    
    // Display old server roles
    console.log('\nRoles on old server:');
    oldRoles.forEach(role => {
      console.log(`- ${role.name} (ID: ${role.id})`);
      if (role.description) {
        console.log(`  Description: ${role.description}`);
      }
    });
    
    // Display new server roles
    console.log('\nRoles on new server:');
    newRoles.forEach(role => {
      console.log(`- ${role.name} (ID: ${role.id})`);
    });
    
    // Find roles that exist on old server but not on new server
    const newRoleNames = newRoles.map(role => role.name);
    const rolesToCopy = oldRoles.filter(role => !newRoleNames.includes(role.name));
    
    if (rolesToCopy.length === 0) {
      console.log('\n✓ All roles from old server already exist on new server');
      return;
    }
    
    console.log(`\nFound ${rolesToCopy.length} roles to copy:`);
    rolesToCopy.forEach(role => {
      console.log(`- ${role.name}`);
    });
    
    // Copy missing roles
    console.log('\nCopying roles...');
    for (const role of rolesToCopy) {
      try {
        const newRole = await createRoleOnNewServer(role);
        console.log(`✓ Created role: ${newRole.name} (ID: ${newRole.id})`);
      } catch (error) {
        console.log(`✗ Failed to create role: ${role.name}`);
      }
    }
    
    console.log('\n🎉 Role copying completed!');
    
  } catch (error) {
    console.error('❌ Role copying failed:', error.message);
    process.exit(1);
  }
}

main();