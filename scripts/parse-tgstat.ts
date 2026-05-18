import axios from 'axios';
import * as cheerio from 'cheerio';

const DIRECTUS_URL = 'https://directus.nplanner.ru';
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;

// Маппинг категорий TGStat -> наши категории
const categoryMapping: Record<string, { tgstatUrl: string, ourCategoryId: string, ourCategoryName: string }> = {
  sport: { 
    tgstatUrl: 'https://tgstat.ru/sport', 
    ourCategoryId: 'aa94a23a-64b6-4de5-ac16-ab1c2a6706c8', 
    ourCategoryName: 'entertainment' 
  },
  entertainment: { 
    tgstatUrl: 'https://tgstat.ru/ratings/channels/entertainment', 
    ourCategoryId: 'aa94a23a-64b6-4de5-ac16-ab1c2a6706c8', 
    ourCategoryName: 'entertainment' 
  },
  tech: { 
    tgstatUrl: 'https://tgstat.ru/ratings/channels/tech', 
    ourCategoryId: 'c336d3c3-746c-4d55-b401-765fb982b5ce', 
    ourCategoryName: 'tech' 
  },
  business: { 
    tgstatUrl: 'https://tgstat.ru/ratings/channels/business', 
    ourCategoryId: '16874c0e-8f29-4d91-a3e5-c60bdcfd92c4', 
    ourCategoryName: 'business' 
  },
  marketing: { 
    tgstatUrl: 'https://tgstat.ru/ratings/channels/marketing', 
    ourCategoryId: '74592250-a310-4bad-88c1-09f17f1afd32', 
    ourCategoryName: 'marketing' 
  },
  food: { 
    tgstatUrl: 'https://tgstat.ru/ratings/channels/food', 
    ourCategoryId: '7a6e03da-e9ef-4822-bd78-1a9ef56a2077', 
    ourCategoryName: 'food' 
  },
  travel: { 
    tgstatUrl: 'https://tgstat.ru/ratings/channels/travel', 
    ourCategoryId: '0b580755-2872-44d8-8d5c-ffdfa1983c15', 
    ourCategoryName: 'travel' 
  },
  fashion: { 
    tgstatUrl: 'https://tgstat.ru/ratings/channels/fashion', 
    ourCategoryId: 'a88dac45-de51-4119-9253-05945986b3b5', 
    ourCategoryName: 'fashion' 
  },
  health: { 
    tgstatUrl: 'https://tgstat.ru/ratings/channels/health', 
    ourCategoryId: '9d75d053-24c5-4635-b8c0-58dcd3e7bd03', 
    ourCategoryName: 'health' 
  },
  finance: { 
    tgstatUrl: 'https://tgstat.ru/ratings/channels/finance', 
    ourCategoryId: '8cecc24c-90a4-4511-b898-59f96a6b0b03', 
    ourCategoryName: 'finance' 
  },
  education: { 
    tgstatUrl: 'https://tgstat.ru/ratings/channels/education', 
    ourCategoryId: 'd6c42fc0-c8a4-4415-a7e3-8737c7ccd7af', 
    ourCategoryName: 'education' 
  },
  news: { 
    tgstatUrl: 'https://tgstat.ru/ratings/channels/news', 
    ourCategoryId: '329c0622-6528-4046-9780-6b452c017c81', 
    ourCategoryName: 'news' 
  },
  crypto: { 
    tgstatUrl: 'https://tgstat.ru/ratings/channels/crypto', 
    ourCategoryId: '14510433-569e-4f29-bf82-6e56a2b3947f', 
    ourCategoryName: 'crypto' 
  }
};

interface ParsedChannel {
  username: string;
  title: string;
  category_id: string;
  subscribers: number;
  avg_post_reach: number;
  engagement_rate: number;
  language: string;
  description?: string;
  link?: string;
}

async function parseCategory(categoryName: string, limit: number = 10): Promise<ParsedChannel[]> {
  const config = categoryMapping[categoryName];
  if (!config) {
    console.error(`❌ Категория ${categoryName} не найдена`);
    return [];
  }

  console.log(`\n📡 Парсим категорию: ${categoryName} (${config.tgstatUrl})`);
  
  try {
    const response = await axios.get(config.tgstatUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const html = response.data;
    const channels: ParsedChannel[] = [];

    // Извлекаем данные из window.__NUXT__
    const nuxtMatch = html.match(/window\.__NUXT__\s*=\s*({.+?})\s*<\/script>/s);
    
    if (!nuxtMatch) {
      console.error('❌ Не найден window.__NUXT__ в ответе');
      return [];
    }

    const nuxtData = JSON.parse(nuxtMatch[1]);
    
    // Ищем массив каналов в структуре данных
    let channelsData: any[] = [];
    
    // Пробуем разные пути к данным
    if (nuxtData?.data?.[0]?.items) {
      channelsData = nuxtData.data[0].items;
    } else if (nuxtData?.data?.items) {
      channelsData = nuxtData.data.items;
    } else if (nuxtData?.state?.data?.items) {
      channelsData = nuxtData.state.data.items;
    } else if (Array.isArray(nuxtData?.data?.[0])) {
      channelsData = nuxtData.data[0];
    }

    if (channelsData.length === 0) {
      console.error('❌ Не найдены данные о каналах в JSON');
      console.log('Структура данных:', JSON.stringify(Object.keys(nuxtData), null, 2));
      return [];
    }

    // Парсим данные о каналах
    channelsData.slice(0, limit).forEach((item: any) => {
      try {
        const username = item.username || item.link?.replace('@', '');
        const title = item.title || item.name;
        const subscribers = parseInt(item.subscribers) || 0;
        const avg_post_reach = parseInt(item.avg_post_reach) || 0;
        const engagement_rate = parseFloat(item.err || item.engagement_rate) || 0;
        const description = item.description || `Канал категории ${config.ourCategoryName}`;

        if (username && title) {
          channels.push({
            username,
            title,
            category_id: config.ourCategoryId,
            subscribers,
            avg_post_reach,
            engagement_rate,
            language: 'ru',
            link: `https://t.me/${username}`,
            description
          });
        }
      } catch (err) {
        console.error('❌ Ошибка парсинга канала:', err);
      }
    });

    console.log(`✅ Спарсено ${channels.length} каналов`);
    return channels;
    
  } catch (error: any) {
    console.error(`❌ Ошибка при парсинге ${categoryName}:`, error.message);
    return [];
  }
}

function parseNumber(text: string): number {
  // Преобразуем "1.2K" -> 1200, "15.3M" -> 15300000
  const cleaned = text.replace(/\s/g, '');
  if (cleaned.includes('M')) {
    return Math.round(parseFloat(cleaned.replace('M', '')) * 1000000);
  } else if (cleaned.includes('K')) {
    return Math.round(parseFloat(cleaned.replace('K', '')) * 1000);
  }
  return parseInt(cleaned) || 0;
}

async function saveChannelToDirectus(channel: ParsedChannel): Promise<boolean> {
  try {
    await axios.post(
      `${DIRECTUS_URL}/items/telegram_channels`,
      channel,
      {
        headers: {
          'Authorization': `Bearer ${DIRECTUS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return true;
  } catch (error: any) {
    console.error(`❌ Ошибка сохранения @${channel.username}:`, error.response?.data?.errors?.[0]?.message || error.message);
    return false;
  }
}

async function main() {
  const category = process.argv[2];
  const limit = parseInt(process.argv[3]) || 10;

  if (!category) {
    console.log('📋 Использование: npx tsx scripts/parse-tgstat.ts <категория> [лимит]');
    console.log('\nДоступные категории:');
    Object.keys(categoryMapping).forEach(cat => {
      console.log(`  - ${cat}`);
    });
    return;
  }

  console.log(`🚀 Начинаем парсинг категории: ${category} (лимит: ${limit} каналов)`);
  
  const channels = await parseCategory(category, limit);
  
  if (channels.length === 0) {
    console.log('❌ Каналы не найдены');
    return;
  }

  console.log(`\n💾 Сохраняем ${channels.length} каналов в базу данных...`);
  
  let successCount = 0;
  let errorCount = 0;

  for (const channel of channels) {
    const saved = await saveChannelToDirectus(channel);
    if (saved) {
      successCount++;
      console.log(`✅ Сохранён: @${channel.username} (${channel.subscribers.toLocaleString()} подписчиков)`);
    } else {
      errorCount++;
    }
    
    // Небольшая задержка между запросами
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log(`\n📊 Итого для категории ${category}:`);
  console.log(`✅ Успешно сохранено: ${successCount}`);
  console.log(`❌ Ошибок: ${errorCount}`);
}

main();
