
const axios = require('axios');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '.env') });

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://directus.roboflow.space';
const ADMIN_TOKEN = process.env.DIRECTUS_ADMIN_TOKEN;

async function checkFields() {
  try {
    const response = await axios.get(`${DIRECTUS_URL}/fields/business_questionnaire`, {
      headers: {
        'Authorization': `Bearer ${ADMIN_TOKEN}`
      }
    });
    
    console.log('Fields in business_questionnaire:');
    response.data.data.forEach(field => {
      console.log(`- ${field.field} (${field.type})`);
    });
  } catch (error) {
    console.error('Error fetching fields:', error.response?.data || error.message);
  }
}

checkFields();
