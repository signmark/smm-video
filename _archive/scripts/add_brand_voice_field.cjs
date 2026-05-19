
const axios = require('axios');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '.env') });

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://directus.roboflow.space';
const ADMIN_TOKEN = process.env.DIRECTUS_ADMIN_TOKEN;

async function addField() {
  try {
    console.log('Adding brand_voice field to business_questionnaire...');
    const response = await axios.post(`${DIRECTUS_URL}/fields/business_questionnaire`, {
      field: 'brand_voice',
      type: 'text',
      meta: {
        interface: 'input',
        width: 'full',
        note: 'Tone of Voice (Тон общения)'
      }
    }, {
      headers: {
        'Authorization': `Bearer ${ADMIN_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('Field brand_voice added successfully:', response.data);
  } catch (error) {
    if (error.response?.data?.errors?.[0]?.extensions?.code === 'RECORD_NOT_UNIQUE') {
      console.log('Field brand_voice already exists.');
    } else {
      console.error('Error adding field:', error.response?.data || error.message);
    }
  }
}

addField();
