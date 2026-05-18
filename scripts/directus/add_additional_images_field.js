/**
 * Скрипт для добавления поля additional_images в коллекцию campaign_content в Directus
 * Данный скрипт добавляет поддержку хранения дополнительных изображений для постов
 */

import axios from 'axios';
import { config } from 'dotenv';
config();

// Более подробное логирование
const verboseLog = (message, data = null) => {
  console.log(`[VERBOSE] ${message}`);
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  }
};

// Настройки подключения к Directus
const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
const ADMIN_EMAIL = process.env.DIRECTUS_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.DIRECTUS_ADMIN_PASSWORD;

verboseLog(`Using Directus URL: ${DIRECTUS_URL}`);
verboseLog(`Admin email: ${ADMIN_EMAIL ? ADMIN_EMAIL.substring(0, 3) + '***' : 'undefined'}`);
verboseLog(`Admin password exists: ${!!ADMIN_PASSWORD}`);

async function addAdditionalImagesField() {
  console.log('Starting addition of the additional_images field to campaign_content collection...');
  
  // Получение токена администратора
  let adminToken;
  try {
    const authResponse = await axios.post(`${DIRECTUS_URL}/auth/login`, {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });

    adminToken = authResponse.data.data.access_token;
    console.log('Successfully authenticated as admin');
  } catch (error) {
    console.error('Failed to authenticate:', error.response?.data || error.message);
    return;
  }

  // Проверка наличия поля additional_images в коллекции campaign_content
  try {
    verboseLog(`Requesting fields for collection campaign_content from ${DIRECTUS_URL}/fields/campaign_content`);
    
    const fieldsResponse = await axios.get(
      `${DIRECTUS_URL}/fields/campaign_content`,
      {
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      }
    );

    verboseLog(`Fields response status: ${fieldsResponse.status}`);
    verboseLog(`Fields response data:`, fieldsResponse.data);

    const existingFields = fieldsResponse.data.data;
    verboseLog(`Found ${existingFields.length} fields in the collection`);
    
    const additionalImagesField = existingFields.find(field => field.field === 'additional_images');
    verboseLog(`Field additional_images exists: ${!!additionalImagesField}`);

    if (additionalImagesField) {
      console.log('Field additional_images already exists in campaign_content collection');
      return;
    }

    // Добавление поля additional_images
    const fieldData = {
      field: 'additional_images',
      type: 'json',
      schema: {
        name: 'additional_images',
        comment: 'Массив URL-адресов дополнительных изображений',
        default_value: '[]'
      },
      meta: {
        interface: 'list',
        special: ['cast-json'],
        display: 'related-values',
        options: {
          template: '{{value}}',
          fields: [
            {
              field: 'value',
              name: 'URL изображения',
              type: 'string',
              meta: {
                interface: 'input',
                width: 'full'
              }
            }
          ]
        },
        width: 'full',
        group: 'content',
        translation: 'Дополнительные изображения'
      }
    };
    
    verboseLog(`Sending field creation request to ${DIRECTUS_URL}/fields/campaign_content`, fieldData);

    try {
      const createResponse = await axios.post(
        `${DIRECTUS_URL}/fields/campaign_content`,
        fieldData,
        {
          headers: {
            Authorization: `Bearer ${adminToken}`,
          },
        }
      );
      
      verboseLog(`Field creation response status: ${createResponse.status}`);
      verboseLog(`Field creation response data:`, createResponse.data);
      
      console.log('Successfully added additional_images field to campaign_content collection');
    } catch (fieldCreateError) {
      verboseLog(`Field creation error:`, fieldCreateError.response?.data || fieldCreateError.message);
      console.error('Error during field creation API call:', fieldCreateError.response?.data || fieldCreateError.message);
      throw fieldCreateError; // Re-throw to be caught by the outer try/catch
    }
  } catch (error) {
    console.error('Failed to add field:', error.response?.data || error.message);
    
    // Если ошибка связана с тем, что поле уже существует на уровне БД, но не в схеме Directus
    if (error.response?.data?.errors?.[0]?.extensions?.code === 'COLUMN_EXISTS') {
      console.log('Field already exists in the database. Adding it to Directus schema...');
      await addFieldViaSQL(adminToken);
    }
  }
}

async function addFieldViaSQL(adminToken) {
  try {
    // Сначала проверим, существует ли поле уже в базе данных
    const checkColumnQuery = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'campaign_content' AND column_name = 'additional_images';
    `;

    verboseLog(`Checking if column exists in database via SQL`);
    
    let checkResponse;
    try {
      checkResponse = await axios.post(
        `${DIRECTUS_URL}/operations/sql`,
        { query: checkColumnQuery },
        {
          headers: {
            Authorization: `Bearer ${adminToken}`,
          },
        }
      );
      
      verboseLog(`Database column check response:`, checkResponse.data);
      
      // Если колонка не существует, сначала создадим её в базе данных
      if (!checkResponse.data.data || checkResponse.data.data.length === 0) {
        const createColumnQuery = `
          ALTER TABLE campaign_content ADD COLUMN additional_images JSON DEFAULT '[]'::json;
        `;
        
        verboseLog(`Column doesn't exist, creating it with SQL:`, createColumnQuery);
        
        await axios.post(
          `${DIRECTUS_URL}/operations/sql`,
          { query: createColumnQuery },
          {
            headers: {
              Authorization: `Bearer ${adminToken}`,
            },
          }
        );
        
        console.log('Successfully added additional_images column to database');
      } else {
        verboseLog(`Column already exists in the database, just need to register it with Directus`);
      }
    } catch (checkError) {
      verboseLog(`Error checking column:`, checkError.response?.data || checkError.message);
      console.error('Error checking for column:', checkError.response?.data || checkError.message);
    }
    
    // Использование SQL-операции для добавления поля в схему Directus
    const addFieldQuery = `
      INSERT INTO directus_fields (collection, field, special, interface, options, display, width, "group", translation)
      VALUES (
        'campaign_content',
        'additional_images',
        '["cast-json"]',
        'list',
        '{"template":"{{value}}","fields":[{"field":"value","name":"URL изображения","type":"string","meta":{"interface":"input","width":"full"}}]}',
        'related-values',
        'full',
        'content',
        '{"ru-RU":"Дополнительные изображения","en-US":"Additional Images"}'
      )
      ON CONFLICT DO NOTHING;
    `;
    
    verboseLog(`Registering field with Directus via SQL:`, addFieldQuery);

    const fieldResponse = await axios.post(
      `${DIRECTUS_URL}/operations/sql`,
      { query: addFieldQuery },
      {
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      }
    );
    
    verboseLog(`SQL field registration response:`, fieldResponse.data);

    console.log('Successfully added field to Directus schema via SQL');
  } catch (error) {
    verboseLog(`Error in SQL operation:`, error.response?.data || error.message);
    console.error('Failed to add field via SQL:', error.response?.data || error.message);
  }
}

// Запуск скрипта
addAdditionalImagesField()
  .then(() => {
    console.log('Script completed');
  })
  .catch(error => {
    console.error('Script failed:', error);
  });