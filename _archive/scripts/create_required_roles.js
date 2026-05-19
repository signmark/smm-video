/**
 * Script to create required roles for the SMM system
 */

import axios from 'axios';

const DIRECTUS_URL = 'https://directus.roboflow.tech';
const ADMIN_TOKEN = process.env.DIRECTUS_ADMIN_TOKEN;

async function createRole(roleData) {
  try {
    const response = await axios.post(`${DIRECTUS_URL}/roles`, roleData, {
      headers: {
        'Authorization': `Bearer ${ADMIN_TOKEN}`
      }
    });
    
    return response.data.data;
  } catch (error) {
    if (error.response?.status === 400 && error.response.data?.errors?.[0]?.message?.includes('unique')) {
      console.log(`⚠ Role ${roleData.name} already exists, skipping...`);
      return null;
    }
    console.error(`Failed to create role ${roleData.name}:`, error.response?.data || error.message);
    throw error;
  }
}

async function main() {
  try {
    console.log('Creating required roles for SMM system...');
    
    if (!ADMIN_TOKEN) {
      throw new Error('DIRECTUS_ADMIN_TOKEN not found');
    }

    const rolesToCreate = [
      {
        name: 'SMM Manager User',
        icon: 'person',
        description: 'Standard SMM user role with basic campaign management access',
        admin_access: false,
        app_access: true,
        enforce_tfa: false
      },
      {
        name: 'SMM Admin',
        icon: 'admin_panel_settings',
        description: 'SMM administrator with full system access',
        admin_access: false,
        app_access: true,
        enforce_tfa: false
      },
      {
        name: 'Content Creator',
        icon: 'create',
        description: 'Role for content creators with content management access',
        admin_access: false,
        app_access: true,
        enforce_tfa: false
      },
      {
        name: 'Analytics Viewer',
        icon: 'analytics',
        description: 'Read-only access to analytics and reports',
        admin_access: false,
        app_access: true,
        enforce_tfa: false
      }
    ];

    console.log(`Creating ${rolesToCreate.length} roles...`);

    for (const roleData of rolesToCreate) {
      try {
        const newRole = await createRole(roleData);
        if (newRole) {
          console.log(`✓ Created role: ${newRole.name} (ID: ${newRole.id})`);
        }
      } catch (error) {
        console.log(`✗ Failed to create role: ${roleData.name}`);
      }
    }

    console.log('Role creation completed!');
    
  } catch (error) {
    console.error('Role creation failed:', error.message);
    process.exit(1);
  }
}

main();