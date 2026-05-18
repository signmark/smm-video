/**
 * Скрипт для создания необходимых коллекций в Directus на новом сервере
 */

import axios from 'axios';

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://directus.roboflow.space';
const ADMIN_EMAIL = process.env.DIRECTUS_ADMIN_EMAIL || 'admin@roboflow.space';
const ADMIN_PASSWORD = process.env.DIRECTUS_ADMIN_PASSWORD || 'roboflow_admin_2025';

let authToken = null;

// Аутентификация администратора
async function authenticate() {
  try {
    console.log(`Авторизация администратора: ${ADMIN_EMAIL}`);
    
    const response = await axios.post(`${DIRECTUS_URL}/auth/login`, {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD
    });
    
    authToken = response.data.data.access_token;
    console.log('Авторизация успешна');
    return authToken;
  } catch (error) {
    console.error('Ошибка авторизации:', error.response?.data || error.message);
    throw error;
  }
}

// Создание коллекции
async function createCollection(collectionData) {
  try {
    console.log(`Создание коллекции: ${collectionData.collection}`);
    
    const response = await axios.post(`${DIRECTUS_URL}/collections`, collectionData, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`Коллекция ${collectionData.collection} создана успешно`);
    return response.data;
  } catch (error) {
    if (error.response?.status === 409) {
      console.log(`Коллекция ${collectionData.collection} уже существует`);
      return null;
    }
    console.error(`Ошибка создания коллекции ${collectionData.collection}:`, error.response?.data || error.message);
    throw error;
  }
}

// Создание поля
async function createField(collection, fieldData) {
  try {
    console.log(`Создание поля ${fieldData.field} в коллекции ${collection}`);
    
    const response = await axios.post(`${DIRECTUS_URL}/fields/${collection}`, fieldData, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`Поле ${fieldData.field} создано успешно`);
    return response.data;
  } catch (error) {
    if (error.response?.status === 409) {
      console.log(`Поле ${fieldData.field} уже существует`);
      return null;
    }
    console.error(`Ошибка создания поля ${fieldData.field}:`, error.response?.data || error.message);
    throw error;
  }
}

// Определения коллекций
const collections = [
  {
    collection: 'user_campaigns',
    meta: {
      collection: 'user_campaigns',
      icon: 'campaign',
      note: 'Кампании пользователей',
      display_template: '{{name}}'
    },
    schema: {
      name: 'user_campaigns'
    }
  },
  {
    collection: 'campaign_content',
    meta: {
      collection: 'campaign_content',
      icon: 'article',
      note: 'Контент кампаний',
      display_template: '{{title}}'
    },
    schema: {
      name: 'campaign_content'
    }
  },
  {
    collection: 'global_api_keys',
    meta: {
      collection: 'global_api_keys',
      icon: 'key',
      note: 'Глобальные API ключи',
      display_template: '{{name}}'
    },
    schema: {
      name: 'global_api_keys'
    }
  },
  {
    collection: 'business_questionnaires',
    meta: {
      collection: 'business_questionnaires',
      icon: 'quiz',
      note: 'Бизнес анкеты',
      display_template: '{{company_name}}'
    },
    schema: {
      name: 'business_questionnaires'
    }
  }
];

// Определения полей для user_campaigns
const userCampaignsFields = [
  {
    field: 'id',
    type: 'uuid',
    meta: {
      field: 'id',
      special: ['uuid'],
      interface: 'input',
      options: {},
      display: 'raw',
      display_options: {},
      readonly: true,
      hidden: true,
      sort: 1,
      width: 'full',
      translations: {},
      note: null
    },
    schema: {
      name: 'id',
      table: 'user_campaigns',
      data_type: 'uuid',
      default_value: null,
      max_length: null,
      numeric_precision: null,
      numeric_scale: null,
      is_nullable: false,
      is_unique: false,
      is_primary_key: true,
      has_auto_increment: false,
      foreign_key_column: null,
      foreign_key_table: null
    }
  },
  {
    field: 'name',
    type: 'string',
    meta: {
      field: 'name',
      special: [],
      interface: 'input',
      options: {},
      display: 'raw',
      display_options: {},
      readonly: false,
      hidden: false,
      sort: 2,
      width: 'full',
      translations: {},
      note: null
    },
    schema: {
      name: 'name',
      table: 'user_campaigns',
      data_type: 'varchar',
      default_value: null,
      max_length: 255,
      numeric_precision: null,
      numeric_scale: null,
      is_nullable: false,
      is_unique: false,
      is_primary_key: false,
      has_auto_increment: false,
      foreign_key_column: null,
      foreign_key_table: null
    }
  },
  {
    field: 'description',
    type: 'text',
    meta: {
      field: 'description',
      special: [],
      interface: 'input-multiline',
      options: {},
      display: 'raw',
      display_options: {},
      readonly: false,
      hidden: false,
      sort: 3,
      width: 'full',
      translations: {},
      note: null
    },
    schema: {
      name: 'description',
      table: 'user_campaigns',
      data_type: 'text',
      default_value: null,
      max_length: null,
      numeric_precision: null,
      numeric_scale: null,
      is_nullable: true,
      is_unique: false,
      is_primary_key: false,
      has_auto_increment: false,
      foreign_key_column: null,
      foreign_key_table: null
    }
  },
  {
    field: 'user_id',
    type: 'uuid',
    meta: {
      field: 'user_id',
      special: [],
      interface: 'input',
      options: {},
      display: 'raw',
      display_options: {},
      readonly: false,
      hidden: false,
      sort: 4,
      width: 'full',
      translations: {},
      note: null
    },
    schema: {
      name: 'user_id',
      table: 'user_campaigns',
      data_type: 'uuid',
      default_value: null,
      max_length: null,
      numeric_precision: null,
      numeric_scale: null,
      is_nullable: false,
      is_unique: false,
      is_primary_key: false,
      has_auto_increment: false,
      foreign_key_column: null,
      foreign_key_table: null
    }
  },
  {
    field: 'created_at',
    type: 'timestamp',
    meta: {
      field: 'created_at',
      special: ['date-created'],
      interface: 'datetime',
      options: {},
      display: 'datetime',
      display_options: {},
      readonly: true,
      hidden: true,
      sort: 5,
      width: 'half',
      translations: {},
      note: null
    },
    schema: {
      name: 'created_at',
      table: 'user_campaigns',
      data_type: 'timestamp',
      default_value: 'CURRENT_TIMESTAMP',
      max_length: null,
      numeric_precision: null,
      numeric_scale: null,
      is_nullable: false,
      is_unique: false,
      is_primary_key: false,
      has_auto_increment: false,
      foreign_key_column: null,
      foreign_key_table: null
    }
  }
];

// Определения полей для global_api_keys
const globalApiKeysFields = [
  {
    field: 'id',
    type: 'uuid',
    meta: {
      field: 'id',
      special: ['uuid'],
      interface: 'input',
      options: {},
      display: 'raw',
      display_options: {},
      readonly: true,
      hidden: true,
      sort: 1,
      width: 'full',
      translations: {},
      note: null
    },
    schema: {
      name: 'id',
      table: 'global_api_keys',
      data_type: 'uuid',
      default_value: null,
      max_length: null,
      numeric_precision: null,
      numeric_scale: null,
      is_nullable: false,
      is_unique: false,
      is_primary_key: true,
      has_auto_increment: false,
      foreign_key_column: null,
      foreign_key_table: null
    }
  },
  {
    field: 'name',
    type: 'string',
    meta: {
      field: 'name',
      special: [],
      interface: 'input',
      options: {},
      display: 'raw',
      display_options: {},
      readonly: false,
      hidden: false,
      sort: 2,
      width: 'full',
      translations: {},
      note: null
    },
    schema: {
      name: 'name',
      table: 'global_api_keys',
      data_type: 'varchar',
      default_value: null,
      max_length: 255,
      numeric_precision: null,
      numeric_scale: null,
      is_nullable: false,
      is_unique: false,
      is_primary_key: false,
      has_auto_increment: false,
      foreign_key_column: null,
      foreign_key_table: null
    }
  },
  {
    field: 'service_name',
    type: 'string',
    meta: {
      field: 'service_name',
      special: [],
      interface: 'input',
      options: {},
      display: 'raw',
      display_options: {},
      readonly: false,
      hidden: false,
      sort: 3,
      width: 'full',
      translations: {},
      note: null
    },
    schema: {
      name: 'service_name',
      table: 'global_api_keys',
      data_type: 'varchar',
      default_value: null,
      max_length: 100,
      numeric_precision: null,
      numeric_scale: null,
      is_nullable: false,
      is_unique: false,
      is_primary_key: false,
      has_auto_increment: false,
      foreign_key_column: null,
      foreign_key_table: null
    }
  },
  {
    field: 'api_key',
    type: 'string',
    meta: {
      field: 'api_key',
      special: [],
      interface: 'input',
      options: {},
      display: 'raw',
      display_options: {},
      readonly: false,
      hidden: false,
      sort: 4,
      width: 'full',
      translations: {},
      note: null
    },
    schema: {
      name: 'api_key',
      table: 'global_api_keys',
      data_type: 'varchar',
      default_value: null,
      max_length: 1000,
      numeric_precision: null,
      numeric_scale: null,
      is_nullable: false,
      is_unique: false,
      is_primary_key: false,
      has_auto_increment: false,
      foreign_key_column: null,
      foreign_key_table: null
    }
  },
  {
    field: 'status',
    type: 'string',
    meta: {
      field: 'status',
      special: [],
      interface: 'select-dropdown',
      options: {
        choices: [
          { text: 'Active', value: 'active' },
          { text: 'Inactive', value: 'inactive' }
        ]
      },
      display: 'labels',
      display_options: {},
      readonly: false,
      hidden: false,
      sort: 5,
      width: 'half',
      translations: {},
      note: null
    },
    schema: {
      name: 'status',
      table: 'global_api_keys',
      data_type: 'varchar',
      default_value: 'active',
      max_length: 50,
      numeric_precision: null,
      numeric_scale: null,
      is_nullable: false,
      is_unique: false,
      is_primary_key: false,
      has_auto_increment: false,
      foreign_key_column: null,
      foreign_key_table: null
    }
  }
];

// Основная функция
async function main() {
  try {
    console.log('Начинаем создание коллекций Directus...\n');
    
    // Аутентификация
    await authenticate();
    
    // Создаем коллекции
    for (const collection of collections) {
      await createCollection(collection);
    }
    
    console.log('\nСоздание полей для user_campaigns...');
    for (const field of userCampaignsFields) {
      await createField('user_campaigns', field);
    }
    
    console.log('\nСоздание полей для global_api_keys...');
    for (const field of globalApiKeysFields) {
      await createField('global_api_keys', field);
    }
    
    console.log('\n✅ Все коллекции и поля созданы успешно!');
    
  } catch (error) {
    console.error('\n❌ Ошибка при создании коллекций:', error.message);
    process.exit(1);
  }
}

main();