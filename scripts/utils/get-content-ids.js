const axios = require('axios');
require('dotenv').config();

async function getContentIds() {
  try {
    const directusUrl = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
    const adminEmail = process.env.DIRECTUS_ADMIN_EMAIL;
    const adminPassword = process.env.DIRECTUS_ADMIN_PASSWORD;
    
    // 1. Get admin token
    const authResponse = await axios.post(, {
      email: adminEmail,
      password: adminPassword
    });
    
    const token = authResponse.data.data.access_token;
    
    // 2. Get content list
    const contentResponse = await axios.get(
      , 
      {
        headers: {
          'Authorization': 
        }
      }
    );
    
    // 3. Display content IDs
    const contentItems = contentResponse.data.data;
    contentItems.forEach(item => {
      console.log();
    });
    
  } catch (error) {
    console.error('Ошибка:', error.message);
    if (error.response) {
      console.error('Ответ API:', error.response.data);
    }
  }
}

getContentIds();
