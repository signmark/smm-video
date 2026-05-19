/**
 * Script to refresh Directus schema for campaign_content collection
 * Updates field metadata to match the correct database structure
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

async function refreshSchema(token) {
  try {
    const response = await axios.post(`${DIRECTUS_URL}/schema/refresh`, {}, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('✓ Schema refreshed successfully');
    return response.data;
  } catch (error) {
    console.error('Error refreshing schema:', error.response?.data || error.message);
    throw error;
  }
}

async function updateFieldMetadata(token) {
  // Update keywords field to use proper text interface instead of JSON
  try {
    await axios.patch(`${DIRECTUS_URL}/fields/campaign_content/keywords`, {
      meta: {
        interface: 'input-multiline',
        special: null,
        options: {
          placeholder: 'Enter keywords separated by commas'
        }
      }
    }, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('✓ Updated keywords field interface');
  } catch (error) {
    console.log('⚠ Keywords field update skipped:', error.response?.data?.errors?.[0]?.message || error.message);
  }

  // Update required fields metadata
  const requiredFields = ['campaign_id', 'user_id', 'content', 'content_type'];
  for (const fieldName of requiredFields) {
    try {
      await axios.patch(`${DIRECTUS_URL}/fields/campaign_content/${fieldName}`, {
        meta: {
          required: true
        }
      }, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      console.log(`✓ Updated ${fieldName} as required field`);
    } catch (error) {
      console.log(`⚠ ${fieldName} field update skipped:`, error.response?.data?.errors?.[0]?.message || error.message);
    }
  }
}

async function main() {
  try {
    console.log('🔧 Refreshing Directus schema for campaign_content...');
    
    const token = await authenticate();
    console.log('✓ Authenticated successfully');

    // Refresh the schema first
    await refreshSchema(token);
    
    // Update field metadata
    await updateFieldMetadata(token);

    console.log('🎉 Schema refresh completed successfully!');
    console.log('Campaign content collection now reflects the correct database structure.');
    
  } catch (error) {
    console.error('❌ Schema refresh failed:', error.message);
    process.exit(1);
  }
}

main();