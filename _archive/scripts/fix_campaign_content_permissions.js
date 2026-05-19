/**
 * Script to create campaign_content collection in Directus with proper structure
 * Based on the structure shown in the screenshot
 */

import axios from 'axios';

const DIRECTUS_URL = 'https://directus.roboflow.tech';
const ADMIN_EMAIL = process.env.DIRECTUS_ADMIN_EMAIL || 'lbrspb@gmail.com';
const ADMIN_PASSWORD = process.env.DIRECTUS_ADMIN_PASSWORD || 'lbrspb2024';

async function authenticate() {
  try {
    const response = await axios.post(`${DIRECTUS_URL}/auth/login`, {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD
    });
    
    return response.data.data.access_token;
  } catch (error) {
    console.error('Authentication failed:', error.response?.data || error.message);
    throw error;
  }
}

async function createCollection(token) {
  try {
    // Проверяем, существует ли коллекция
    try {
      const existingCollection = await axios.get(`${DIRECTUS_URL}/collections/campaign_content`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      console.log('Collection campaign_content already exists');
      return existingCollection.data.data;
    } catch (error) {
      if (error.response?.status !== 404) {
        throw error;
      }
    }

    // Создаем коллекцию
    const collectionData = {
      collection: 'campaign_content',
      meta: {
        collection: 'campaign_content',
        icon: 'article',
        note: 'Campaign Content Collection',
        display_template: '{{title}}',
        hidden: false,
        singleton: false,
        translations: null,
        archive_field: null,
        archive_app_filter: true,
        archive_value: null,
        unarchive_value: null,
        sort_field: null,
        accountability: 'all',
        color: null,
        item_duplication_fields: null,
        sort: null,
        group: null,
        collapse: 'open'
      },
      schema: {
        name: 'campaign_content'
      }
    };

    const response = await axios.post(`${DIRECTUS_URL}/collections`, collectionData, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✓ Created collection: campaign_content');
    return response.data.data;
  } catch (error) {
    console.error('Error creating collection:', error.response?.data || error.message);
    throw error;
  }
}

async function createFields(token) {
  const fields = [
    {
      field: 'id',
      type: 'uuid',
      meta: {
        field: 'id',
        special: ['uuid'],
        interface: 'input',
        options: null,
        display: null,
        display_options: null,
        readonly: true,
        hidden: true,
        sort: 1,
        width: 'full',
        translations: null,
        note: null,
        conditions: null,
        required: false,
        group: null,
        validation: null,
        validation_message: null
      },
      schema: {
        name: 'id',
        table: 'campaign_content',
        data_type: 'uuid',
        default_value: 'gen_random_uuid()',
        max_length: null,
        numeric_precision: null,
        numeric_scale: null,
        is_nullable: false,
        is_unique: false,
        is_primary_key: true,
        has_auto_increment: false,
        foreign_key_column: null,
        foreign_key_table: null,
        comment: null
      }
    },
    {
      field: 'title',
      type: 'string',
      meta: {
        field: 'title',
        special: null,
        interface: 'input',
        options: null,
        display: null,
        display_options: null,
        readonly: false,
        hidden: false,
        sort: 2,
        width: 'full',
        translations: null,
        note: null,
        conditions: null,
        required: false,
        group: null,
        validation: null,
        validation_message: null
      },
      schema: {
        name: 'title',
        table: 'campaign_content',
        data_type: 'varchar',
        default_value: null,
        max_length: 255,
        numeric_precision: null,
        numeric_scale: null,
        is_nullable: true,
        is_unique: false,
        is_primary_key: false,
        has_auto_increment: false,
        foreign_key_column: null,
        foreign_key_table: null,
        comment: null
      }
    },
    {
      field: 'campaign_id',
      type: 'uuid',
      meta: {
        field: 'campaign_id',
        special: null,
        interface: 'select-dropdown-m2o',
        options: {
          template: '{{name}}'
        },
        display: 'related-values',
        display_options: {
          template: '{{name}}'
        },
        readonly: false,
        hidden: false,
        sort: 3,
        width: 'full',
        translations: null,
        note: null,
        conditions: null,
        required: false,
        group: null,
        validation: null,
        validation_message: null
      },
      schema: {
        name: 'campaign_id',
        table: 'campaign_content',
        data_type: 'uuid',
        default_value: null,
        max_length: null,
        numeric_precision: null,
        numeric_scale: null,
        is_nullable: true,
        is_unique: false,
        is_primary_key: false,
        has_auto_increment: false,
        foreign_key_column: 'id',
        foreign_key_table: 'user_campaigns',
        comment: null
      }
    },
    {
      field: 'user_id',
      type: 'uuid',
      meta: {
        field: 'user_id',
        special: null,
        interface: 'select-dropdown-m2o',
        options: {
          template: '{{first_name}} {{last_name}}'
        },
        display: 'related-values',
        display_options: {
          template: '{{first_name}} {{last_name}}'
        },
        readonly: false,
        hidden: false,
        sort: 4,
        width: 'full',
        translations: null,
        note: null,
        conditions: null,
        required: false,
        group: null,
        validation: null,
        validation_message: null
      },
      schema: {
        name: 'user_id',
        table: 'campaign_content',
        data_type: 'uuid',
        default_value: null,
        max_length: null,
        numeric_precision: null,
        numeric_scale: null,
        is_nullable: true,
        is_unique: false,
        is_primary_key: false,
        has_auto_increment: false,
        foreign_key_column: 'id',
        foreign_key_table: 'directus_users',
        comment: null
      }
    },
    {
      field: 'content',
      type: 'text',
      meta: {
        field: 'content',
        special: null,
        interface: 'input-multiline',
        options: null,
        display: null,
        display_options: null,
        readonly: false,
        hidden: false,
        sort: 5,
        width: 'full',
        translations: null,
        note: null,
        conditions: null,
        required: false,
        group: null,
        validation: null,
        validation_message: null
      },
      schema: {
        name: 'content',
        table: 'campaign_content',
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
        foreign_key_table: null,
        comment: null
      }
    },
    {
      field: 'content_type',
      type: 'string',
      meta: {
        field: 'content_type',
        special: null,
        interface: 'select-dropdown',
        options: {
          choices: [
            { text: 'Text', value: 'text' },
            { text: 'Image URL', value: 'image_url' },
            { text: 'Video', value: 'video' }
          ]
        },
        display: null,
        display_options: null,
        readonly: false,
        hidden: false,
        sort: 6,
        width: 'full',
        translations: null,
        note: null,
        conditions: null,
        required: false,
        group: null,
        validation: null,
        validation_message: null
      },
      schema: {
        name: 'content_type',
        table: 'campaign_content',
        data_type: 'varchar',
        default_value: 'text',
        max_length: 255,
        numeric_precision: null,
        numeric_scale: null,
        is_nullable: true,
        is_unique: false,
        is_primary_key: false,
        has_auto_increment: false,
        foreign_key_column: null,
        foreign_key_table: null,
        comment: null
      }
    },
    {
      field: 'image_url',
      type: 'string',
      meta: {
        field: 'image_url',
        special: null,
        interface: 'input',
        options: null,
        display: null,
        display_options: null,
        readonly: false,
        hidden: false,
        sort: 7,
        width: 'full',
        translations: null,
        note: null,
        conditions: null,
        required: false,
        group: null,
        validation: null,
        validation_message: null
      },
      schema: {
        name: 'image_url',
        table: 'campaign_content',
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
        foreign_key_table: null,
        comment: null
      }
    },
    {
      field: 'video_url',
      type: 'string',
      meta: {
        field: 'video_url',
        special: null,
        interface: 'input',
        options: null,
        display: null,
        display_options: null,
        readonly: false,
        hidden: false,
        sort: 8,
        width: 'full',
        translations: null,
        note: null,
        conditions: null,
        required: false,
        group: null,
        validation: null,
        validation_message: null
      },
      schema: {
        name: 'video_url',
        table: 'campaign_content',
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
        foreign_key_table: null,
        comment: null
      }
    },
    {
      field: 'prompt',
      type: 'text',
      meta: {
        field: 'prompt',
        special: null,
        interface: 'input-multiline',
        options: null,
        display: null,
        display_options: null,
        readonly: false,
        hidden: false,
        sort: 9,
        width: 'full',
        translations: null,
        note: null,
        conditions: null,
        required: false,
        group: null,
        validation: null,
        validation_message: null
      },
      schema: {
        name: 'prompt',
        table: 'campaign_content',
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
        foreign_key_table: null,
        comment: null
      }
    },
    {
      field: 'keywords',
      type: 'json',
      meta: {
        field: 'keywords',
        special: ['cast-json'],
        interface: 'list',
        options: null,
        display: null,
        display_options: null,
        readonly: false,
        hidden: false,
        sort: 10,
        width: 'full',
        translations: null,
        note: null,
        conditions: null,
        required: false,
        group: null,
        validation: null,
        validation_message: null
      },
      schema: {
        name: 'keywords',
        table: 'campaign_content',
        data_type: 'json',
        default_value: null,
        max_length: null,
        numeric_precision: null,
        numeric_scale: null,
        is_nullable: true,
        is_unique: false,
        is_primary_key: false,
        has_auto_increment: false,
        foreign_key_column: null,
        foreign_key_table: null,
        comment: null
      }
    },
    {
      field: 'created_at',
      type: 'timestamp',
      meta: {
        field: 'created_at',
        special: ['date-created'],
        interface: 'datetime',
        options: null,
        display: 'datetime',
        display_options: {
          relative: true
        },
        readonly: true,
        hidden: false,
        sort: 11,
        width: 'half',
        translations: null,
        note: null,
        conditions: null,
        required: false,
        group: null,
        validation: null,
        validation_message: null
      },
      schema: {
        name: 'created_at',
        table: 'campaign_content',
        data_type: 'timestamp',
        default_value: 'CURRENT_TIMESTAMP',
        max_length: null,
        numeric_precision: null,
        numeric_scale: null,
        is_nullable: true,
        is_unique: false,
        is_primary_key: false,
        has_auto_increment: false,
        foreign_key_column: null,
        foreign_key_table: null,
        comment: null
      }
    },
    {
      field: 'scheduled_at',
      type: 'timestamp',
      meta: {
        field: 'scheduled_at',
        special: null,
        interface: 'datetime',
        options: null,
        display: 'datetime',
        display_options: null,
        readonly: false,
        hidden: false,
        sort: 12,
        width: 'half',
        translations: null,
        note: null,
        conditions: null,
        required: false,
        group: null,
        validation: null,
        validation_message: null
      },
      schema: {
        name: 'scheduled_at',
        table: 'campaign_content',
        data_type: 'timestamp',
        default_value: null,
        max_length: null,
        numeric_precision: null,
        numeric_scale: null,
        is_nullable: true,
        is_unique: false,
        is_primary_key: false,
        has_auto_increment: false,
        foreign_key_column: null,
        foreign_key_table: null,
        comment: null
      }
    },
    {
      field: 'published_at',
      type: 'timestamp',
      meta: {
        field: 'published_at',
        special: null,
        interface: 'datetime',
        options: null,
        display: 'datetime',
        display_options: null,
        readonly: false,
        hidden: false,
        sort: 13,
        width: 'half',
        translations: null,
        note: null,
        conditions: null,
        required: false,
        group: null,
        validation: null,
        validation_message: null
      },
      schema: {
        name: 'published_at',
        table: 'campaign_content',
        data_type: 'timestamp',
        default_value: null,
        max_length: null,
        numeric_precision: null,
        numeric_scale: null,
        is_nullable: true,
        is_unique: false,
        is_primary_key: false,
        has_auto_increment: false,
        foreign_key_column: null,
        foreign_key_table: null,
        comment: null
      }
    },
    {
      field: 'status',
      type: 'string',
      meta: {
        field: 'status',
        special: null,
        interface: 'select-dropdown',
        options: {
          choices: [
            { text: 'Draft', value: 'draft' },
            { text: 'Scheduled', value: 'scheduled' },
            { text: 'Published', value: 'published' }
          ]
        },
        display: null,
        display_options: null,
        readonly: false,
        hidden: false,
        sort: 14,
        width: 'half',
        translations: null,
        note: null,
        conditions: null,
        required: false,
        group: null,
        validation: null,
        validation_message: null
      },
      schema: {
        name: 'status',
        table: 'campaign_content',
        data_type: 'varchar',
        default_value: 'draft',
        max_length: 255,
        numeric_precision: null,
        numeric_scale: null,
        is_nullable: true,
        is_unique: false,
        is_primary_key: false,
        has_auto_increment: false,
        foreign_key_column: null,
        foreign_key_table: null,
        comment: null
      }
    },
    {
      field: 'social_platforms',
      type: 'json',
      meta: {
        field: 'social_platforms',
        special: ['cast-json'],
        interface: 'input-code',
        options: {
          language: 'json'
        },
        display: null,
        display_options: null,
        readonly: false,
        hidden: false,
        sort: 15,
        width: 'full',
        translations: null,
        note: null,
        conditions: null,
        required: false,
        group: null,
        validation: null,
        validation_message: null
      },
      schema: {
        name: 'social_platforms',
        table: 'campaign_content',
        data_type: 'json',
        default_value: null,
        max_length: null,
        numeric_precision: null,
        numeric_scale: null,
        is_nullable: true,
        is_unique: false,
        is_primary_key: false,
        has_auto_increment: false,
        foreign_key_column: null,
        foreign_key_table: null,
        comment: null
      }
    },
    {
      field: 'additional_images',
      type: 'json',
      meta: {
        field: 'additional_images',
        special: ['cast-json'],
        interface: 'list',
        options: null,
        display: null,
        display_options: null,
        readonly: false,
        hidden: false,
        sort: 16,
        width: 'full',
        translations: null,
        note: null,
        conditions: null,
        required: false,
        group: null,
        validation: null,
        validation_message: null
      },
      schema: {
        name: 'additional_images',
        table: 'campaign_content',
        data_type: 'json',
        default_value: null,
        max_length: null,
        numeric_precision: null,
        numeric_scale: null,
        is_nullable: true,
        is_unique: false,
        is_primary_key: false,
        has_auto_increment: false,
        foreign_key_column: null,
        foreign_key_table: null,
        comment: null
      }
    },
    {
      field: 'additional_media',
      type: 'json',
      meta: {
        field: 'additional_media',
        special: ['cast-json'],
        interface: 'input-code',
        options: {
          language: 'json'
        },
        display: null,
        display_options: null,
        readonly: false,
        hidden: false,
        sort: 17,
        width: 'full',
        translations: null,
        note: null,
        conditions: null,
        required: false,
        group: null,
        validation: null,
        validation_message: null
      },
      schema: {
        name: 'additional_media',
        table: 'campaign_content',
        data_type: 'json',
        default_value: null,
        max_length: null,
        numeric_precision: null,
        numeric_scale: null,
        is_nullable: true,
        is_unique: false,
        is_primary_key: false,
        has_auto_increment: false,
        foreign_key_column: null,
        foreign_key_table: null,
        comment: null
      }
    }
  ];

  for (const fieldData of fields) {
    try {
      await axios.post(`${DIRECTUS_URL}/fields/campaign_content`, fieldData, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      console.log(`✓ Created field: ${fieldData.field}`);
    } catch (error) {
      if (error.response?.status === 400 && error.response?.data?.errors?.[0]?.message?.includes('already exists')) {
        console.log(`⚠ Field ${fieldData.field} already exists, skipping`);
      } else {
        console.error(`Error creating field ${fieldData.field}:`, error.response?.data || error.message);
      }
    }
  }
}

async function main() {
  try {
    console.log('🔧 Creating campaign_content collection in Directus...');
    
    const token = await authenticate();
    console.log('✓ Authenticated successfully');

    // Создаем коллекцию
    await createCollection(token);
    
    // Создаем поля
    await createFields(token);

    console.log('🎉 Campaign content collection created successfully!');
    console.log('Collection structure matches the screenshot from old server.');
    
  } catch (error) {
    console.error('❌ Collection creation failed:', error.message);
    process.exit(1);
  }
}

main();