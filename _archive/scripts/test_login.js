import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

async function testLogin() {
  try {
    const response = await axios.post('https://directus.roboflow.space/auth/login', {
      email: process.env.DIRECTUS_ADMIN_EMAIL,
      password: process.env.DIRECTUS_ADMIN_PASSWORD
    });
    console.log('✅ Login Success!');
    console.log('Access Token:', response.data.data.access_token);
    
    // Тест запроса с новым токеном
    const contentResponse = await axios.get('https://directus.roboflow.space/items/campaign_content', {
      headers: { Authorization: `Bearer ${response.data.data.access_token}` }
    });
    console.log('✅ Content Fetch Success!', contentResponse.data.data.length, 'items');
  } catch (error) {
    console.error('❌ Login Failed:', error.response?.data || error.message);
  }
}

testLogin();
