/**
 * Скрипт для исправления регистрации поля additional_images в коллекции campaign_content в Directus
 * Данный скрипт корректирует метаданные поля, чтобы оно корректно отображалось в интерфейсе Directus
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

async function fixAdditionalImagesField() {
  console.log('Starting fix for the additional_images field in campaign_content collection...');
  
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
      // Если поле существует, попробуем обновить его метаданные
      console.log('Field additional_images exists. Attempting to update its metadata...');
      
      // Удаляем существующую запись о поле из Directus
      try {
        await axios.delete(
          `${DIRECTUS_URL}/fields/campaign_content/additional_images`,
          {
            headers: {
              Authorization: `Bearer ${adminToken}`,
            },
          }
        );
        console.log('Successfully deleted existing field metadata from Directus');
      } catch (deleteError) {
        console.error('Failed to delete field metadata:', deleteError.response?.data || deleteError.message);
      }
    }

    // Определяем корректные метаданные для поля массива строк
    await fixFieldViaSQL(adminToken);
    console.log('Successfully updated additional_images field metadata in Directus');
  } catch (error) {
    console.error('Failed to update field:', error.response?.data || error.message);
  }
}

async function fixFieldViaSQL(adminToken) {
  try {
    // Сначала проверим, что колонка существует в базе данных
    const checkColumnQuery = `
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'campaign_content' AND column_name = 'additional_images';
    `;

    verboseLog(`Checking if column exists in database via SQL`);
    
    const checkResponse = await axios.post(
      `${DIRECTUS_URL}/operations/sql`,
      { query: checkColumnQuery },
      {
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      }
    );
    
    verboseLog(`Database column check response:`, checkResponse.data);
    
    if (!checkResponse.data.data || checkResponse.data.data.length === 0) {
      console.log('Column additional_images does not exist in the database. Creating it...');
      
      // Создаем колонку для массива строк
      const createColumnQuery = `
        ALTER TABLE campaign_content ADD COLUMN additional_images TEXT[] DEFAULT '{}';
      `;
      
      verboseLog(`Creating column with SQL:`, createColumnQuery);
      
      await axios.post(
        `${DIRECTUS_URL}/operations/sql`,
        { query: createColumnQuery },
        {
          headers: {
            Authorization: `Bearer ${adminToken}`,
          },
        }
      );
      
      console.log('Successfully added additional_images column (TEXT[]) to database');
    } else {
      const dataType = checkResponse.data.data[0].data_type.toLowerCase();
      verboseLog(`Column exists with data type: ${dataType}`);
      
      // Если тип данных не ARRAY, нужно преобразовать колонку
      if (dataType !== 'ARRAY' && dataType !== 'text[]') {
        console.log(`Current column type is ${dataType}, converting to TEXT[]...`);
        
        // Сначала создаем временную колонку
        const alterQuery = `
          ALTER TABLE campaign_content 
          ADD COLUMN additional_images_temp TEXT[] DEFAULT '{}';
          
          -- Обновляем временную колонку, используя данные из JSON колонки
          UPDATE campaign_content 
          SET additional_images_temp = 
            CASE 
              WHEN additional_images IS NULL THEN '{}'::TEXT[]
              WHEN additional_images::TEXT = '[]' THEN '{}'::TEXT[]
              WHEN jsonb_typeof(additional_images::JSONB) = 'array' THEN 
                (SELECT array_agg(elem::TEXT) FROM jsonb_array_elements_text(additional_images::JSONB) elem)
              ELSE '{}'::TEXT[]
            END;
          
          -- Удаляем старую колонку
          ALTER TABLE campaign_content DROP COLUMN additional_images;
          
          -- Переименовываем временную колонку
          ALTER TABLE campaign_content RENAME COLUMN additional_images_temp TO additional_images;
        `;
        
        verboseLog(`Converting column with SQL:`, alterQuery);
        
        await axios.post(
          `${DIRECTUS_URL}/operations/sql`,
          { query: alterQuery },
          {
            headers: {
              Authorization: `Bearer ${adminToken}`,
            },
          }
        );
        
        console.log('Successfully converted additional_images column to TEXT[]');
      }
    }
    
    // Регистрируем поле в Directus с правильными метаданными для массива строк
    const addFieldQuery = `
      INSERT INTO directus_fields (collection, field, special, interface, options, display, width, "group", translation)
      VALUES (
        'campaign_content',
        'additional_images',
        '["cast-csv"]',
        'tags',
        '{"iconLeft":"link"}',
        'tags',
        'full',
        'content',
        '{"ru-RU":"Дополнительные изображения","en-US":"Additional Images"}'
      )
      ON CONFLICT (collection, field) DO UPDATE
      SET 
        special = '["cast-csv"]',
        interface = 'tags',
        options = '{"iconLeft":"link"}',
        display = 'tags',
        width = 'full',
        "group" = 'content',
        translation = '{"ru-RU":"Дополнительные изображения","en-US":"Additional Images"}';
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

    console.log('Successfully registered field with Directus schema via SQL');
  } catch (error) {
    verboseLog(`Error in SQL operation:`, error.response?.data || error.message);
    console.error('Failed to fix field via SQL:', error.response?.data || error.message);
  }
}

// Запуск скрипта
fixAdditionalImagesField()
  .then(() => {
    console.log('Script completed');
  })
  .catch(error => {
    console.error('Script failed:', error);
  });