/**
 * Script to get admin token from old Directus server
 */

import axios from 'axios';

const OLD_DIRECTUS_URL = 'https://directus.nplanner.ru';
const ADMIN_EMAIL = 'lbrspb@gmail.com';
const ADMIN_PASSWORD = 'Qwerty123';

async function getOldAdminToken() {
  try {
    console.log('🔑 Getting admin token from old server...');
    
    const response = await axios.post(`${OLD_DIRECTUS_URL}/auth/login`, {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD
    });
    
    const token = response.data.data.access_token;
    console.log('✅ Successfully got admin token from old server');
    console.log(`Token starts with: ${token.substring(0, 20)}...`);
    
    // Test the token
    const testResponse = await axios.get(`${OLD_DIRECTUS_URL}/users/me`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    console.log(`✅ Token is valid for user: ${testResponse.data.data.email}`);
    console.log('\n📋 Copy this token and update DIRECTUS_ADMIN_TOKEN:');
    console.log(token);
    
    return token;
  } catch (error) {
    console.error('❌ Failed to get admin token:', error.response?.data || error.message);
    throw error;
  }
}

getOldAdminToken().catch(console.error);