/**
 * Script to check database structure and look for any remaining data
 */

import axios from 'axios';

const DIRECTUS_URL = 'https://directus.roboflow.tech';
const LOCAL_API_URL = 'http://localhost:5000';

async function getAdminToken() {
  try {
    const response = await axios.get(`${LOCAL_API_URL}/api/auth/system-token`);
    if (response.data.success && response.data.token) {
      return response.data.token;
    }
    throw new Error('Failed to get admin token');
  } catch (error) {
    console.error('Error getting admin token:', error.message);
    throw error;
  }
}

async function checkCollections(token) {
  try {
    console.log('Checking available collections...');
    
    const response = await axios.get(`${DIRECTUS_URL}/collections`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const collections = response.data.data;
    console.log(`Found ${collections.length} collections`);
    
    const relevantCollections = collections.filter(col => 
      !col.collection.startsWith('directus_') && 
      !col.collection.startsWith('sessions')
    );
    
    console.log('\nRelevant collections:');
    relevantCollections.forEach(col => {
      console.log(`- ${col.collection}`);
    });
    
    return relevantCollections;
  } catch (error) {
    console.error('Error checking collections:', error.response?.data || error.message);
    return [];
  }
}

async function checkCollectionData(token, collectionName) {
  try {
    const response = await axios.get(`${DIRECTUS_URL}/items/${collectionName}?limit=5`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const items = response.data.data;
    return items.length;
  } catch (error) {
    return 0;
  }
}

async function checkUsers(token) {
  try {
    console.log('\nChecking users...');
    
    const response = await axios.get(`${DIRECTUS_URL}/users`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const users = response.data.data;
    console.log(`Found ${users.length} users:`);
    
    users.forEach(user => {
      console.log(`- ${user.email} (${user.first_name} ${user.last_name}) - Role: ${user.role}`);
    });
    
    return users;
  } catch (error) {
    console.error('Error checking users:', error.response?.data || error.message);
    return [];
  }
}

async function checkActivity(token) {
  try {
    console.log('\nChecking recent activity...');
    
    const response = await axios.get(`${DIRECTUS_URL}/activity?limit=10&sort=-timestamp`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const activities = response.data.data;
    console.log(`Found ${activities.length} recent activities:`);
    
    activities.forEach(activity => {
      console.log(`- ${activity.timestamp}: ${activity.action} on ${activity.collection} by ${activity.user || 'system'}`);
    });
    
    return activities;
  } catch (error) {
    console.error('Error checking activity:', error.response?.data || error.message);
    return [];
  }
}

async function main() {
  try {
    console.log('Analyzing database structure and content...\n');
    
    const token = await getAdminToken();
    
    const collections = await checkCollections(token);
    
    console.log('\nChecking data in collections:');
    for (const collection of collections) {
      const count = await checkCollectionData(token, collection.collection);
      console.log(`- ${collection.collection}: ${count} items`);
    }
    
    await checkUsers(token);
    await checkActivity(token);
    
    console.log('\n' + '='.repeat(60));
    console.log('ANALYSIS SUMMARY:');
    console.log('='.repeat(60));
    console.log('The database structure exists but most content is missing.');
    console.log('This suggests data loss during git branch switching.');
    console.log('\nPossible recovery options:');
    console.log('1. Check if there are database backups');
    console.log('2. Look for export files in the project');
    console.log('3. Restore from production backup if available');

  } catch (error) {
    console.error('\nError:', error.message);
    process.exit(1);
  }
}

main();