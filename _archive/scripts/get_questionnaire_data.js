
import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://directus.roboflow.tech';
const ADMIN_TOKEN = process.env.DIRECTUS_ADMIN_TOKEN;
const CAMPAIGN_ID = '177e7245-a911-4b82-90be-4a9ff0203032';

async function getQuestionnaire() {
  try {
    const response = await axios.get(`${DIRECTUS_URL}/items/business_questionnaire`, {
      params: { 
        filter: JSON.stringify({ campaign_id: { _eq: CAMPAIGN_ID } }) 
      },
      headers: {
        'Authorization': `Bearer ${ADMIN_TOKEN}`
      }
    });

    if (response.data.data && response.data.data.length > 0) {
        const data = response.data.data[0];
        console.log(JSON.stringify(data, null, 2));
    } else {
        console.log('No questionnaire found for this campaign.');
    }

  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

getQuestionnaire();
