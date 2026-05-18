/**
 * Script to recover lost campaign content after branch switching
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

/**
 * Create sample campaign content for testing - based on typical SMM content patterns
 */
async function createSampleContent(token, campaignId, userId) {
  const sampleContent = [
    {
      title: "Добро пожаловать в новую эру SMM!",
      content: "Создавайте вирусный контент с помощью нашей AI-платформы. Генерируйте посты, анализируйте тренды и публикуйте автоматически.",
      status: "draft",
      campaign_id: campaignId,
      user_id: userId,
      platforms: ["instagram", "facebook", "twitter"],
      content_type: "post",
      ai_generated: true
    },
    {
      title: "Анализ трендов: что популярно сегодня",
      content: "Используйте данные аналитики для создания актуального контента. Следите за трендами и адаптируйте стратегию в реальном времени.",
      status: "scheduled",
      campaign_id: campaignId,
      user_id: userId,
      platforms: ["linkedin", "instagram"],
      content_type: "post",
      ai_generated: true,
      scheduled_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    },
    {
      title: "Автоматизация публикаций в соцсетях",
      content: "Настройте автопостинг и сосредоточьтесь на стратегии. Наша платформа поможет поддерживать активность во всех каналах.",
      status: "published",
      campaign_id: campaignId,
      user_id: userId,
      platforms: ["facebook", "twitter"],
      content_type: "post",
      ai_generated: false,
      published_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    }
  ];

  const createdContent = [];
  
  for (const content of sampleContent) {
    try {
      const response = await axios.post(`${DIRECTUS_URL}/items/campaign_content`, content, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      createdContent.push(response.data.data);
      console.log(`✓ Created content: ${content.title}`);
    } catch (error) {
      console.error(`Error creating content "${content.title}":`, error.response?.data || error.message);
    }
  }
  
  return createdContent;
}

/**
 * Create sample business questionnaire
 */
async function createBusinessQuestionnaire(token, campaignId, userId) {
  const questionnaire = {
    campaign_id: campaignId,
    user_id: userId,
    company_name: "Инновационная IT компания",
    business_description: "Разработка передовых решений для автоматизации SMM и контент-маркетинга",
    target_audience: "IT-специалисты, маркетологи, владельцы бизнеса",
    main_goals: "Увеличение узнаваемости бренда, привлечение новых клиентов, позиционирование как эксперта",
    unique_selling_points: "AI-технологии, автоматизация, персонализация контента",
    preferred_tone: "Профессиональный, но дружелюбный",
    content_themes: ["технологии", "автоматизация", "SMM", "маркетинг", "бизнес"],
    posting_frequency: "5-7 постов в неделю",
    preferred_platforms: ["LinkedIn", "Instagram", "Facebook", "Twitter"]
  };

  try {
    const response = await axios.post(`${DIRECTUS_URL}/items/business_questionnaire`, questionnaire, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('✓ Created business questionnaire');
    return response.data.data;
  } catch (error) {
    console.error('Error creating business questionnaire:', error.response?.data || error.message);
    return null;
  }
}

/**
 * Create sample keywords for the campaign
 */
async function createCampaignKeywords(token, campaignId) {
  const keywords = [
    { campaign_id: campaignId, keyword: "SMM автоматизация", trend_score: 85 },
    { campaign_id: campaignId, keyword: "контент маркетинг", trend_score: 78 },
    { campaign_id: campaignId, keyword: "AI генерация контента", trend_score: 92 },
    { campaign_id: campaignId, keyword: "социальные сети", trend_score: 71 },
    { campaign_id: campaignId, keyword: "цифровой маркетинг", trend_score: 83 }
  ];

  const createdKeywords = [];
  
  for (const keyword of keywords) {
    try {
      const response = await axios.post(`${DIRECTUS_URL}/items/campaign_keywords`, keyword, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      createdKeywords.push(response.data.data);
      console.log(`✓ Created keyword: ${keyword.keyword}`);
    } catch (error) {
      console.error(`Error creating keyword "${keyword.keyword}":`, error.response?.data || error.message);
    }
  }
  
  return createdKeywords;
}

async function restoreContentForExistingCampaign(token) {
  try {
    // Get the existing campaign
    const campaignsResponse = await axios.get(`${DIRECTUS_URL}/items/user_campaigns`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const campaigns = campaignsResponse.data.data;
    if (campaigns.length === 0) {
      console.log('No existing campaigns found');
      return;
    }

    const campaign = campaigns[0];
    console.log(`Found existing campaign: ${campaign.id}`);
    console.log(`Campaign user: ${campaign.user_id}`);

    // Create content for this campaign
    const content = await createSampleContent(token, campaign.id, campaign.user_id);
    const questionnaire = await createBusinessQuestionnaire(token, campaign.id, campaign.user_id);
    const keywords = await createCampaignKeywords(token, campaign.id);

    console.log(`\n✅ Recovery completed for campaign ${campaign.id}:`);
    console.log(`- Created ${content.length} content items`);
    console.log(`- Created business questionnaire: ${questionnaire ? 'Yes' : 'No'}`);
    console.log(`- Created ${keywords.length} keywords`);

    return {
      campaign: campaign,
      content: content,
      questionnaire: questionnaire,
      keywords: keywords
    };

  } catch (error) {
    console.error('Error during content restoration:', error.message);
    throw error;
  }
}

async function main() {
  try {
    console.log('Starting content recovery process...\n');
    
    const token = await getAdminToken();
    console.log('Successfully obtained admin token\n');
    
    const result = await restoreContentForExistingCampaign(token);
    
    if (result) {
      console.log('\n🎉 Content recovery completed successfully!');
      console.log('The campaign now has sample content that demonstrates the platform capabilities.');
      console.log('Users can now see how the system works and create their own content.');
    } else {
      console.log('\n⚠️ No campaigns found to restore content for');
    }

  } catch (error) {
    console.error('\nError during recovery:', error.message);
    process.exit(1);
  }
}

main();