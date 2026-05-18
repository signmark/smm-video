import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;

if (!DIRECTUS_TOKEN) {
  console.error('❌ DIRECTUS_TOKEN не найден');
  process.exit(1);
}

// Все категории из парсера
const allCategories = [
  'tech', 'business', 'marketing', 'food', 'travel', 'fashion', 
  'health', 'finance', 'education', 'news', 'crypto', 'sport',
  'blogs', 'humor', 'games', 'pictures', 'psychology', 'music',
  'quotes', 'video', 'educational', 'art', 'politics', 'economy',
  'books', 'career', 'medicine', 'design', 'linguistics', 'crafts',
  'software', 'law', 'courses', 'media', 'technologies', 'startups',
  'beauty', 'adult', 'entertainment', 'animals', 'auto', 'religion',
  'realestate', 'sales', 'family', 'job', 'other', 'movies', 
  'science', 'esoteric', 'betting', 'shock', 'erotic', 'darknet'
];

interface CategoryStats {
  categoryId: string;
  categoryName: string;
  count: number;
  tgstatUrl: string;
}

async function getCategoryStats(): Promise<CategoryStats[]> {
  const stats: CategoryStats[] = [];
  
  console.log('📊 Анализ категорий телеграм-каналов...\n');
  
  // Получаем все уникальные category_id из базы
  try {
    const response = await axios.get(`${DIRECTUS_URL}/items/telegram_channels`, {
      params: {
        'groupBy[]': 'category_id',
        'aggregate[count]': 'id',
        'limit': -1
      },
      headers: {
        'Authorization': `Bearer ${DIRECTUS_TOKEN}`
      }
    });
    
    const groups = response.data.data || [];
    
    for (const group of groups) {
      stats.push({
        categoryId: group.category_id || 'unknown',
        categoryName: '', // Заполним позже
        count: group.count?.id || 0,
        tgstatUrl: ''
      });
    }
  } catch (error: any) {
    console.error('Ошибка получения статистики:', error.message);
  }
  
  return stats;
}

async function getTotalChannels(): Promise<number> {
  try {
    const response = await axios.get(`${DIRECTUS_URL}/items/telegram_channels`, {
      params: {
        'meta': 'total_count',
        'limit': 1
      },
      headers: {
        'Authorization': `Bearer ${DIRECTUS_TOKEN}`
      }
    });
    return response.data.meta?.total_count || 0;
  } catch (error) {
    return 0;
  }
}

async function getChannelCountByCategory(categoryId: string): Promise<number> {
  try {
    const response = await axios.get(`${DIRECTUS_URL}/items/telegram_channels`, {
      params: {
        'filter': JSON.stringify({ category_id: { _eq: categoryId } }),
        'aggregate[count]': '*',
        'limit': 1
      },
      headers: {
        'Authorization': `Bearer ${DIRECTUS_TOKEN}`
      }
    });
    // Directus возвращает агрегацию в формате [{ count: X }]
    const data = response.data.data;
    if (Array.isArray(data) && data.length > 0) {
      return data[0].count || 0;
    }
    return 0;
  } catch (error: any) {
    console.error(`   Ошибка для ${categoryId}:`, error.message);
    return 0;
  }
}

async function deleteChannelsByCategory(categoryId: string): Promise<number> {
  try {
    // Сначала получаем все ID каналов в этой категории
    const response = await axios.get(`${DIRECTUS_URL}/items/telegram_channels`, {
      params: {
        'filter[category_id][_eq]': categoryId,
        'fields': 'id',
        'limit': -1
      },
      headers: {
        'Authorization': `Bearer ${DIRECTUS_TOKEN}`
      }
    });
    
    const channels = response.data.data || [];
    
    if (channels.length === 0) {
      return 0;
    }
    
    // Удаляем пачками по 100
    const ids = channels.map((c: any) => c.id);
    const batchSize = 100;
    let deleted = 0;
    
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      await axios.delete(`${DIRECTUS_URL}/items/telegram_channels`, {
        data: batch,
        headers: {
          'Authorization': `Bearer ${DIRECTUS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      deleted += batch.length;
      console.log(`   Удалено ${deleted}/${ids.length}...`);
    }
    
    return deleted;
  } catch (error: any) {
    console.error(`   Ошибка удаления: ${error.message}`);
    return 0;
  }
}

// Правильный маппинг category_id -> categoryName из Directus
const categoryIdToName: Record<string, string> = {
  // 12 категорий из реальной базы Directus
  'c336d3c3-746c-4d55-b401-765fb982b5ce': 'tech',
  '16874c0e-8f29-4d91-a3e5-c60bdcfd92c4': 'business',
  '74592250-a310-4bad-88c1-09f17f1afd32': 'marketing',
  '7a6e03da-e9ef-4822-bd78-1a9ef56a2077': 'food',
  '0b580755-2872-44d8-8d5c-ffdfa1983c15': 'travel',
  'a88dac45-de51-4119-9253-05945986b3b5': 'fashion',
  '9d75d053-24c5-4635-b8c0-58dcd3e7bd03': 'health',
  '8cecc24c-90a4-4511-b898-59f96a6b0b03': 'finance',
  'd6c42fc0-c8a4-4415-a7e3-8737c7ccd7af': 'education',
  '329c0622-6528-4046-9780-6b452c017c81': 'news',
  '14510433-569e-4f29-bf82-6e56a2b3947f': 'crypto',
  'aa94a23a-64b6-4de5-ac16-ab1c2a6706c8': 'entertainment',
};

// Известные категории TGStat
const validTgstatCategories = new Set([
  'tech', 'business', 'marketing', 'food', 'travel', 'fashion', 
  'health', 'finance', 'education', 'news', 'crypto', 'sport',
  'blogs', 'humor', 'games', 'pictures', 'psychology', 'music',
  'quotes', 'video', 'educational', 'art', 'politics', 'economy',
  'books', 'career', 'medicine', 'design', 'linguistics', 'crafts',
  'software', 'law', 'courses', 'media', 'technologies', 'startups',
  'beauty', 'adult', 'entertainment', 'animals', 'auto', 'religion',
  'realestate', 'sales', 'family', 'job', 'other', 'movies', 
  'science', 'esoteric', 'betting', 'shock', 'erotic', 'darknet'
]);

async function main() {
  const totalChannels = await getTotalChannels();
  console.log(`📦 Всего каналов в базе: ${totalChannels.toLocaleString()}\n`);
  
  console.log('📋 Статистика по категориям:\n');
  console.log('=' .repeat(70));
  console.log('| Category ID                          | Name           | Count    |');
  console.log('=' .repeat(70));
  
  const emptyCategories: string[] = [];
  const unknownCategories: string[] = [];
  const validCategories: { id: string; name: string; count: number }[] = [];
  
  // Проходим по всем известным category_id
  for (const [categoryId, categoryName] of Object.entries(categoryIdToName)) {
    const count = await getChannelCountByCategory(categoryId);
    
    const status = count === 0 ? '❌ ПУСТО' : '✅';
    console.log(`| ${categoryId} | ${categoryName.padEnd(14)} | ${count.toString().padStart(8)} | ${status}`);
    
    if (count === 0) {
      emptyCategories.push(categoryName);
    } else {
      validCategories.push({ id: categoryId, name: categoryName, count });
    }
  }
  
  console.log('=' .repeat(70));
  
  // Проверяем наличие каналов с неизвестными category_id
  console.log('\n🔍 Поиск каналов с неизвестными category_id...');
  
  try {
    const response = await axios.get(`${DIRECTUS_URL}/items/telegram_channels`, {
      params: {
        'groupBy[]': 'category_id',
        'aggregate[count]': 'id',
        'limit': -1
      },
      headers: {
        'Authorization': `Bearer ${DIRECTUS_TOKEN}`
      }
    });
    
    const groups = response.data.data || [];
    
    for (const group of groups) {
      const catId = group.category_id;
      const count = group.count?.id || 0;
      
      if (!categoryIdToName[catId]) {
        console.log(`   ⚠️ Неизвестный category_id: ${catId} (${count} каналов)`);
        unknownCategories.push(catId);
      }
    }
  } catch (error: any) {
    console.log('   Ошибка проверки:', error.message);
  }
  
  // Итоги
  console.log('\n' + '='.repeat(70));
  console.log('📊 ИТОГИ:');
  console.log('='.repeat(70));
  
  console.log(`\n✅ Заполненные категории (${validCategories.length}):`);
  validCategories
    .sort((a, b) => b.count - a.count)
    .forEach(c => console.log(`   ${c.name}: ${c.count.toLocaleString()}`));
  
  if (emptyCategories.length > 0) {
    console.log(`\n❌ Пустые категории (${emptyCategories.length}) - нужно собрать:`);
    emptyCategories.forEach(c => console.log(`   - ${c}`));
  }
  
  if (unknownCategories.length > 0) {
    console.log(`\n⚠️ Неизвестные category_id (${unknownCategories.length}) - можно удалить:`);
    unknownCategories.forEach(c => console.log(`   - ${c}`));
    
    // Спрашиваем удалять ли
    console.log('\n💡 Для удаления каналов с неизвестными категориями запустите:');
    console.log('   npx tsx scripts/analyze-tgstat-categories.ts --cleanup');
  }
  
  // Если передан флаг --cleanup, удаляем неизвестные категории
  if (process.argv.includes('--cleanup') && unknownCategories.length > 0) {
    console.log('\n🗑️ Удаление каналов с неизвестными категориями...');
    for (const catId of unknownCategories) {
      console.log(`\n   Удаление категории ${catId}...`);
      const deleted = await deleteChannelsByCategory(catId);
      console.log(`   ✅ Удалено ${deleted} каналов`);
    }
  }
  
  // Генерируем команду для сбора пустых категорий
  if (emptyCategories.length > 0) {
    console.log('\n💡 Для сбора пустых категорий запустите:');
    console.log(`   npx tsx scripts/parse-tgstat-puppeteer.ts ${emptyCategories[0]}`);
  }
}

main().catch(console.error);
