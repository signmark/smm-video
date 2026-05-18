// Тест для проверки создания payload в trends/collect
const keywordsList = [
  'создание контента AI для соцсетей',
  'социальные сети', 
  'сервис для SMM с ИИ'
];

const collectSources = true;

console.log('🔍 TEST: Creating payload for collectSources with keywords:', keywordsList.slice(0, 3));
console.log('🔍 TEST: collectSources value:', collectSources);

const followerRequirements = {
  instagram: 5000,
  telegram: 2000,
  vk: 3000,
  facebook: 5000,
  youtube: 10000
};

const selectedPlatforms = ["instagram", "telegram", "vk"];
const maxSourcesPerPlatform = 10;
const maxTrendsPerSource = 10;
const collectionDays = 30;
const campaignId = '45daab2a-4c6f-4578-8665-3a049458c0c8';
const userId = '53921f16-f51d-4591-80b9-8caa4fde4d13';
const requestId = 'test-123';

let payload;

if (collectSources) {
  console.log('✅ TEST: Entering collectSources branch');
  payload = {
    minFollowers: followerRequirements,
    maxSourcesPerPlatform: maxSourcesPerPlatform,
    platforms: selectedPlatforms,
    collectSources: 1,
    collectComments: [],
    keywords: keywordsList,
    maxTrendsPerSource: maxTrendsPerSource,
    day_past: collectionDays,
    language: "ru",
    filters: {
      minReactions: 10,
      minViews: 500,
      contentTypes: ["text", "image", "video"]
    },
    campaignId: campaignId,
    userId: userId,
    requestId: requestId
  };
  console.log('📝 TEST: CREATED CORRECT payload for sources collection:', JSON.stringify(payload, null, 2));
} else {
  console.log('❌ TEST: Should not enter this branch');
}

console.log('🚀 TEST: FINAL PAYLOAD:', JSON.stringify(payload, null, 2));

// Проверим есть ли поле sourcesList (не должно быть)
if (payload.sourcesList) {
  console.error('❌ ОШИБКА: payload содержит sourcesList вместо keywords!');
} else if (payload.keywords) {
  console.log('✅ ПРАВИЛЬНО: payload содержит keywords как и должно быть');
} else {
  console.error('❌ ОШИБКА: payload не содержит ни keywords ни sourcesList!');
}