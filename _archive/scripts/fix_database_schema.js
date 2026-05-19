/**
 * Script to fix the campaign_keywords table schema via Directus API
 * Changes the keyword field from UUID foreign key to VARCHAR direct storage
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

async function deleteCollection(token, collectionName) {
  try {
    await axios.delete(`${DIRECTUS_URL}/collections/${collectionName}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    console.log(`✓ Deleted collection: ${collectionName}`);
  } catch (error) {
    console.log(`Collection ${collectionName} doesn't exist or already deleted`);
  }
}

async function createCampaignKeywordsCollection(token) {
  try {
    // Create the collection
    const collectionResponse = await axios.post(`${DIRECTUS_URL}/collections`, {
      collection: 'campaign_keywords',
      meta: {
        collection: 'campaign_keywords',
        note: 'Keywords associated with campaigns',
        hidden: false,
        singleton: false,
        icon: 'search'
      },
      schema: {
        name: 'campaign_keywords'
      }
    }, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('✓ Created campaign_keywords collection');

    // Create fields
    const fields = [
      {
        field: 'id',
        type: 'uuid',
        meta: {
          field: 'id',
          collection: 'campaign_keywords',
          interface: 'input',
          hidden: true,
          readonly: true
        },
        schema: {
          name: 'id',
          table: 'campaign_keywords',
          data_type: 'uuid',
          default_value: 'gen_random_uuid()',
          is_nullable: false,
          is_primary_key: true
        }
      },
      {
        field: 'campaign_id',
        type: 'uuid',
        meta: {
          field: 'campaign_id',
          collection: 'campaign_keywords',
          interface: 'select-dropdown-m2o',
          display: 'related-values',
          special: ['m2o']
        },
        schema: {
          name: 'campaign_id',
          table: 'campaign_keywords',
          data_type: 'uuid',
          is_nullable: false
        }
      },
      {
        field: 'keyword',
        type: 'string',
        meta: {
          field: 'keyword',
          collection: 'campaign_keywords',
          interface: 'input',
          display: 'raw',
          width: 'full'
        },
        schema: {
          name: 'keyword',
          table: 'campaign_keywords',
          data_type: 'character varying',
          max_length: 255,
          is_nullable: false
        }
      },
      {
        field: 'trend_score',
        type: 'decimal',
        meta: {
          field: 'trend_score',
          collection: 'campaign_keywords',
          interface: 'input',
          display: 'raw'
        },
        schema: {
          name: 'trend_score',
          table: 'campaign_keywords',
          data_type: 'numeric',
          numeric_precision: 5,
          numeric_scale: 2,
          default_value: '0.0'
        }
      },
      {
        field: 'mentions_count',
        type: 'integer',
        meta: {
          field: 'mentions_count',
          collection: 'campaign_keywords',
          interface: 'input',
          display: 'raw'
        },
        schema: {
          name: 'mentions_count',
          table: 'campaign_keywords',
          data_type: 'integer',
          default_value: 0
        }
      },
      {
        field: 'last_checked',
        type: 'timestamp',
        meta: {
          field: 'last_checked',
          collection: 'campaign_keywords',
          interface: 'datetime',
          display: 'datetime'
        },
        schema: {
          name: 'last_checked',
          table: 'campaign_keywords',
          data_type: 'timestamp without time zone',
          default_value: 'CURRENT_TIMESTAMP'
        }
      },
      {
        field: 'date_created',
        type: 'timestamp',
        meta: {
          field: 'date_created',
          collection: 'campaign_keywords',
          interface: 'datetime',
          display: 'datetime',
          readonly: true,
          special: ['date-created']
        },
        schema: {
          name: 'date_created',
          table: 'campaign_keywords',
          data_type: 'timestamp with time zone',
          default_value: 'CURRENT_TIMESTAMP'
        }
      }
    ];

    for (const field of fields) {
      try {
        await axios.post(`${DIRECTUS_URL}/fields/campaign_keywords`, field, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        console.log(`✓ Created field: ${field.field}`);
      } catch (error) {
        console.error(`Error creating field ${field.field}:`, error.response?.data || error.message);
      }
    }

    console.log('✓ Campaign keywords collection recreated successfully');
    
  } catch (error) {
    console.error('Error creating collection:', error.response?.data || error.message);
    throw error;
  }
}

async function main() {
  try {
    console.log('🔧 Starting database schema fix...');
    
    const token = await authenticate();
    console.log('✓ Authenticated successfully');

    // Delete old collections if they exist
    await deleteCollection(token, 'campaign_keywords');
    await deleteCollection(token, 'keywords'); // Remove reference table if exists

    // Recreate campaign_keywords with correct schema
    await createCampaignKeywordsCollection(token);

    console.log('🎉 Database schema fix completed successfully!');
    console.log('The campaign_keywords table now uses VARCHAR for the keyword field.');
    
  } catch (error) {
    console.error('❌ Schema fix failed:', error.message);
    process.exit(1);
  }
}

main();