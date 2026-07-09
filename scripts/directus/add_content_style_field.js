import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
const DIRECTUS_EMAIL = 'signmark@gmail.com';
const DIRECTUS_PASSWORD = 'QtpZ3dh7';

async function addContentStyleField() {
  try {
    console.log('Authenticating with Directus...');
    const authResponse = await axios.post(`${DIRECTUS_URL}/auth/login`, {
      email: DIRECTUS_EMAIL,
      password: DIRECTUS_PASSWORD
    });

    const token = authResponse.data.data.access_token;
    console.log('Successfully authenticated with Directus');

    console.log('Adding content_style field to user_campaigns collection...');
    const response = await axios.post(
      `${DIRECTUS_URL}/fields/user_campaigns`,
      {
        field: 'content_style',
        type: 'json',
        schema: {
          name: 'content_style',
          table: 'user_campaigns',
          data_type: 'json',
          is_nullable: true
        },
        meta: {
          interface: 'input-code',
          special: ['json'],
          options: {
            language: 'json',
            template: JSON.stringify({
              analyzedAt: null,
              rawPostCount: 0,
              style: {
                tone: '',
                vocabulary: '',
                sentenceStructure: '',
                emojiUsage: '',
                formattingPatterns: '',
                hashtagStyle: '',
                callToAction: '',
                averagePostLength: '',
                distinctiveFeatures: ''
              },
              samplePosts: ''
            }, null, 2)
          }
        }
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('Field added successfully:', response.data);
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);

    if (error.response?.status === 403 || error.response?.status === 401) {
      console.log('Trying alternative SQL method...');
      await addFieldViaSQL();
    }
  }
}

async function addFieldViaSQL() {
  try {
    const authResponse = await axios.post(`${DIRECTUS_URL}/auth/login`, {
      email: DIRECTUS_EMAIL,
      password: DIRECTUS_PASSWORD
    });

    const token = authResponse.data.data.access_token;
    console.log('Successfully authenticated with Directus');

    const response = await axios.post(
      `${DIRECTUS_URL}/utils/run-query`,
      {
        query: 'ALTER TABLE user_campaigns ADD COLUMN IF NOT EXISTS content_style JSONB'
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('Field added successfully via SQL:', response.data);
  } catch (error) {
    console.error('Error with SQL method:', error.response?.data || error.message);
  }
}

addContentStyleField();
