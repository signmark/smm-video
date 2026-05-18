/**
 * Script to change trend_score field type from DECIMAL to INTEGER
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

async function updateFieldType(token) {
  try {
    // Update trend_score field to integer type
    const updateResponse = await axios.patch(`${DIRECTUS_URL}/fields/campaign_keywords/trend_score`, {
      type: 'integer',
      schema: {
        name: 'trend_score',
        table: 'campaign_keywords',
        data_type: 'integer',
        default_value: 0
      },
      meta: {
        field: 'trend_score',
        collection: 'campaign_keywords',
        interface: 'input',
        display: 'raw'
      }
    }, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('✓ Updated trend_score field to integer type');
    
  } catch (error) {
    console.error('Error updating field type:', error.response?.data || error.message);
    throw error;
  }
}

async function main() {
  try {
    console.log('🔧 Fixing trend_score field type...');
    
    const token = await authenticate();
    console.log('✓ Authenticated successfully');

    await updateFieldType(token);

    console.log('🎉 Field type updated successfully!');
    console.log('The trend_score field is now INTEGER instead of DECIMAL.');
    
  } catch (error) {
    console.error('❌ Field type update failed:', error.message);
    process.exit(1);
  }
}

main();