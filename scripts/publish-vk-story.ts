/**
 * VK Stories Publishing Script
 * 
 * Публикует контент как Story в VK сообщество.
 * 
 * Использование:
 *   npx tsx scripts/publish-vk-story.ts <contentId>
 * 
 * Пример:
 *   npx tsx scripts/publish-vk-story.ts 304bb6a3-b925-41f5-92de-2ece0361871a
 */

import axios from 'axios';
import FormData from 'form-data';

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://directus.smmmanager.ru';
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;
const VK_ACCESS_TOKEN = process.env.VK_ACCESS_TOKEN;
const VK_GROUP_ID = process.env.VK_GROUP_ID;
const VK_API_VERSION = '5.199';

interface ContentData {
  id: string;
  campaign_id: string;
  image_url?: string;
  video_url?: string;
  content_type?: string;
  status: string;
}

interface CampaignData {
  id: string;
  social_settings: {
    vk?: {
      groupId: string;
      token: string;
    };
  };
}

async function getContentFromDirectus(contentId: string): Promise<ContentData> {
  console.log(`📥 Получаю контент ${contentId} из Directus...`);
  
  const response = await axios.get(
    `${DIRECTUS_URL}/items/campaign_content/${contentId}`,
    {
      headers: {
        'Authorization': `Bearer ${DIRECTUS_TOKEN}`,
      },
    }
  );
  
  console.log('✅ Контент получен:', {
    id: response.data.data.id,
    type: response.data.data.content_type,
    hasImage: !!response.data.data.image_url,
    hasVideo: !!response.data.data.video_url,
  });
  
  return response.data.data;
}

async function getCampaignFromDirectus(campaignId: string): Promise<CampaignData> {
  console.log(`📥 Получаю кампанию ${campaignId} из Directus...`);
  
  // Используем admin token для доступа к user_campaigns
  const adminToken = process.env.DIRECTUS_ADMIN_TOKEN || DIRECTUS_TOKEN;
  
  const response = await axios.get(
    `${DIRECTUS_URL}/items/user_campaigns/${campaignId}`,
    {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
      },
    }
  );
  
  const campaign = response.data.data;
  
  // VK настройки могут быть в social_settings или social_media_settings
  const vkSettings = campaign.social_settings?.vk || campaign.social_media_settings?.vk;
  
  console.log('✅ Кампания получена:', {
    id: campaign.id,
    name: campaign.name,
    hasVkSettings: !!vkSettings,
  });
  
  // Нормализуем структуру
  if (!campaign.social_settings && campaign.social_media_settings) {
    campaign.social_settings = campaign.social_media_settings;
  }
  
  return campaign;
}

async function getVkUploadServer(
  accessToken: string,
  groupId: string,
  isVideo: boolean
): Promise<string> {
  const method = isVideo ? 'stories.getVideoUploadServer' : 'stories.getPhotoUploadServer';
  console.log(`📡 Получаю upload server для ${isVideo ? 'видео' : 'фото'}...`);
  
  const cleanGroupId = groupId.replace('club', '').replace('-', '');
  
  const response = await axios.post(
    `https://api.vk.com/method/${method}`,
    new URLSearchParams({
      group_id: cleanGroupId,
      add_to_news: '1',
      access_token: accessToken,
      v: VK_API_VERSION,
    }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );
  
  if (response.data.error) {
    throw new Error(`VK API Error: ${response.data.error.error_msg}`);
  }
  
  console.log('✅ Upload URL получен');
  return response.data.response.upload_url;
}

async function downloadMedia(url: string): Promise<Buffer> {
  console.log(`📥 Скачиваю медиа: ${url.substring(0, 50)}...`);
  
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
  });
  
  console.log(`✅ Скачано ${(response.data.length / 1024 / 1024).toFixed(2)} MB`);
  return Buffer.from(response.data);
}

async function uploadToVk(
  uploadUrl: string,
  mediaBuffer: Buffer,
  isVideo: boolean
): Promise<string> {
  console.log(`📤 Загружаю ${isVideo ? 'видео' : 'фото'} в VK...`);
  
  const form = new FormData();
  const fieldName = isVideo ? 'video_file' : 'file';
  const fileName = isVideo ? 'story.mp4' : 'story.jpg';
  
  form.append(fieldName, mediaBuffer, {
    filename: fileName,
    contentType: isVideo ? 'video/mp4' : 'image/jpeg',
  });
  
  const response = await axios.post(uploadUrl, form, {
    headers: form.getHeaders(),
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });
  
  if (response.data.error) {
    throw new Error(`Upload Error: ${JSON.stringify(response.data.error)}`);
  }
  
  console.log('✅ Медиа загружено в VK');
  return response.data.response?.upload_result || response.data.upload_result;
}

async function saveStory(
  accessToken: string,
  uploadResult: string
): Promise<{ storyId: string; ownerId: string; storyUrl: string }> {
  console.log('💾 Сохраняю Story в VK...');
  
  const response = await axios.post(
    'https://api.vk.com/method/stories.save',
    new URLSearchParams({
      upload_results: uploadResult,
      access_token: accessToken,
      v: VK_API_VERSION,
    }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );
  
  if (response.data.error) {
    throw new Error(`VK API Error: ${response.data.error.error_msg}`);
  }
  
  const storyItem = response.data.response?.items?.[0];
  const storyId = storyItem?.id || 'unknown';
  const ownerId = storyItem?.owner_id || 'unknown';
  
  // Правильный формат URL для VK Stories: https://vk.com/story{owner_id}_{story_id}
  const storyUrl = `https://vk.com/story${ownerId}_${storyId}`;
  
  console.log(`✅ Story сохранена! ID: ${storyId}, Owner: ${ownerId}`);
  console.log(`📎 URL: ${storyUrl}`);
  
  return { storyId: String(storyId), ownerId: String(ownerId), storyUrl };
}

async function updateContentStatus(
  contentId: string,
  storyUrl: string
): Promise<void> {
  console.log('📝 Обновляю статус контента в Directus...');
  
  await axios.patch(
    `${DIRECTUS_URL}/items/campaign_content/${contentId}`,
    {
      status: 'published',
      published_at: new Date().toISOString(),
      post_url: storyUrl,
    },
    {
      headers: {
        'Authorization': `Bearer ${DIRECTUS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );
  
  console.log('✅ Статус обновлён на "published"');
}

async function publishVkStory(contentId: string): Promise<void> {
  console.log('\n🚀 Начинаю публикацию VK Story\n');
  console.log('='.repeat(50));
  
  // 1. Получить контент
  const content = await getContentFromDirectus(contentId);
  
  // 2. Получить VK настройки (из env или из кампании)
  let vkToken = VK_ACCESS_TOKEN;
  let vkGroupId = VK_GROUP_ID;
  
  if (!vkToken || !vkGroupId) {
    // Попробовать получить из кампании
    try {
      const campaign = await getCampaignFromDirectus(content.campaign_id);
      vkToken = vkToken || campaign.social_settings?.vk?.token;
      vkGroupId = vkGroupId || campaign.social_settings?.vk?.groupId;
    } catch (e) {
      console.log('⚠️ Не удалось получить кампанию, используем env переменные');
    }
  }
  
  // 3. Проверить VK настройки
  if (!vkGroupId || !vkToken) {
    throw new Error('VK настройки не найдены. Установите VK_ACCESS_TOKEN и VK_GROUP_ID');
  }
  
  const vkSettings = { token: vkToken, groupId: vkGroupId };
  
  // 4. Определить тип медиа
  const mediaUrl = content.video_url || content.image_url;
  if (!mediaUrl) {
    throw new Error('Нет медиа файла (video_url или image_url)');
  }
  
  const isVideo = !!content.video_url;
  console.log(`\n📋 Тип контента: ${isVideo ? 'ВИДЕО' : 'ФОТО'}`);
  
  // 5. Получить upload server
  const uploadUrl = await getVkUploadServer(
    vkSettings.token,
    vkSettings.groupId,
    isVideo
  );
  
  // 6. Скачать медиа
  const mediaBuffer = await downloadMedia(mediaUrl);
  
  // 7. Загрузить в VK
  const uploadResult = await uploadToVk(uploadUrl, mediaBuffer, isVideo);
  
  // 8. Сохранить Story
  const { storyId, storyUrl } = await saveStory(vkSettings.token, uploadResult);
  
  // 9. Обновить статус в Directus
  await updateContentStatus(contentId, storyUrl);
  
  console.log('\n' + '='.repeat(50));
  console.log('🎉 УСПЕШНО ОПУБЛИКОВАНО!');
  console.log(`📍 Story URL: ${storyUrl}`);
  console.log(`🆔 Story ID: ${storyId}`);
  console.log('='.repeat(50) + '\n');
}

// Main
const contentId = process.argv[2] || '304bb6a3-b925-41f5-92de-2ece0361871a';

if (!DIRECTUS_TOKEN) {
  console.error('❌ Ошибка: DIRECTUS_TOKEN не установлен');
  console.log('\nУстановите переменную окружения:');
  console.log('  export DIRECTUS_TOKEN="your_token_here"');
  process.exit(1);
}

publishVkStory(contentId)
  .then(() => {
    console.log('✨ Скрипт завершён успешно');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Ошибка публикации:', error.message);
    if (error.response?.data) {
      console.error('Response:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  });
