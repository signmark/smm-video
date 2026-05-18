
import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://directus.roboflow.tech';
const ADMIN_TOKEN = process.env.DIRECTUS_ADMIN_TOKEN;

async function checkFields() {
  try {
    if (!ADMIN_TOKEN) {
        throw new Error('DIRECTUS_ADMIN_TOKEN not found in .env');
    }

    console.log(`Checking fields for business_questionnaire at ${DIRECTUS_URL}...`);
    
    const response = await axios.get(`${DIRECTUS_URL}/fields/business_questionnaire`, {
      headers: {
        'Authorization': `Bearer ${ADMIN_TOKEN}`
      }
    });

    const fields = response.data.data;
    const targetFields = ['business_description', 'main_directions', 'main_activities'];
    
    console.log('\nField Types:');
    fields.filter(f => targetFields.includes(f.field)).forEach(f => {
        console.log(`- ${f.field}: ${f.type} (Limit: ${f.meta?.note || 'N/A'}, Interface: ${f.meta?.interface})`);
        if (f.schema) {
            console.log(`  Schema: data_type=${f.schema.data_type}, max_length=${f.schema.max_length}`);
        }
    });

  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

checkFields();
