/**
 * Script to check the current status of campaign content in the database
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

async function checkCampaignContent(token) {
  try {
    console.log('Checking campaign content...');
    
    const response = await axios.get(`${DIRECTUS_URL}/items/campaign_content`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const content = response.data.data;
    console.log(`Found ${content.length} campaign content items`);
    
    if (content.length > 0) {
      console.log('\nContent items:');
      content.forEach((item, index) => {
        console.log(`${index + 1}. ID: ${item.id}`);
        console.log(`   Title: ${item.title || 'No title'}`);
        console.log(`   Status: ${item.status || 'No status'}`);
        console.log(`   Created: ${item.date_created || 'No date'}`);
        console.log('');
      });
    } else {
      console.log('No campaign content found in database');
    }
    
    return content;
  } catch (error) {
    console.error('Error checking campaign content:', error.response?.data || error.message);
    return [];
  }
}

async function checkUserCampaigns(token) {
  try {
    console.log('Checking user campaigns...');
    
    const response = await axios.get(`${DIRECTUS_URL}/items/user_campaigns`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const campaigns = response.data.data;
    console.log(`Found ${campaigns.length} user campaigns`);
    
    if (campaigns.length > 0) {
      console.log('\nCampaigns:');
      campaigns.forEach((campaign, index) => {
        console.log(`${index + 1}. ID: ${campaign.id}`);
        console.log(`   Name: ${campaign.campaign_name || 'No name'}`);
        console.log(`   User: ${campaign.user_id || 'No user'}`);
        console.log(`   Created: ${campaign.date_created || 'No date'}`);
        console.log('');
      });
    }
    
    return campaigns;
  } catch (error) {
    console.error('Error checking user campaigns:', error.response?.data || error.message);
    return [];
  }
}

async function checkBusinessQuestionnaires(token) {
  try {
    console.log('Checking business questionnaires...');
    
    const response = await axios.get(`${DIRECTUS_URL}/items/business_questionnaire`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const questionnaires = response.data.data;
    console.log(`Found ${questionnaires.length} business questionnaires`);
    
    return questionnaires;
  } catch (error) {
    console.error('Error checking business questionnaires:', error.response?.data || error.message);
    return [];
  }
}

async function main() {
  try {
    console.log('Checking database content status...\n');
    
    const token = await getAdminToken();
    console.log('Successfully obtained admin token\n');
    
    const content = await checkCampaignContent(token);
    console.log('=' .repeat(50));
    
    const campaigns = await checkUserCampaigns(token);
    console.log('=' .repeat(50));
    
    const questionnaires = await checkBusinessQuestionnaires(token);
    console.log('=' .repeat(50));
    
    console.log('\nSummary:');
    console.log(`- Campaign content items: ${content.length}`);
    console.log(`- User campaigns: ${campaigns.length}`);
    console.log(`- Business questionnaires: ${questionnaires.length}`);
    
    if (content.length === 0 && campaigns.length === 0) {
      console.log('\n⚠️ No content found - database appears to be empty');
      console.log('This suggests data loss during branch switching');
    } else {
      console.log('\n✓ Content found in database');
    }

  } catch (error) {
    console.error('\nError:', error.message);
    process.exit(1);
  }
}

main();