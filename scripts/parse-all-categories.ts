import { spawn } from 'child_process';
import axios from 'axios';
import dotenv from 'dotenv';

// Загружаем переменные окружения из .env
dotenv.config();

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;

if (!DIRECTUS_TOKEN) {
  console.error('❌ ОШИБКА: DIRECTUS_TOKEN не найден в переменных окружения!');
  console.error('   Убедитесь, что файл .env содержит DIRECTUS_TOKEN');
  process.exit(1);
}

// Все категории для парсинга (37 категорий, ~100k+ каналов)
const categories = [
  // Оригинальные 12 категорий
  'tech',
  'business', 
  'marketing',
  'food',
  'travel',
  'fashion',
  'health',
  'finance',
  'education',
  'news',
  'crypto',
  'sport',
  
  // Новые 25 категорий
  'blogs',        // 158k каналов - самая большая!
  'humor',        // 45.5k
  'games',        // 61.2k
  'pictures',     // 44.8k
  'psychology',   // 39.2k
  'music',        // 35k
  'quotes',       // 33.9k
  'video',        // 27.8k
  'educational',  // 25.5k
  'art',          // 24.4k
  'politics',     // 20.5k
  'economy',      // 16.8k
  'books',        // 16.8k
  'career',       // 15.6k
  'medicine',     // 11.5k
  'design',       // 9.1k
  'linguistics',  // 7.2k
  'crafts',       // 6.9k
  'software',     // 5.3k
  'law',          // 5.5k
  'courses',      // 2.9k
  'media',        // news_media
  'technologies',
  'startups',
  'beauty'
];

async function randomDelay(min: number, max: number) {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  console.log(`⏳ Ожидание ${Math.floor(delay / 60000)} минут ${Math.floor((delay % 60000) / 1000)} секунд перед следующей категорией...`);
  await new Promise(resolve => setTimeout(resolve, delay));
}

async function getCategoryChannelCount(categoryId: string): Promise<number> {
  try {
    const response = await axios.get(`${DIRECTUS_URL}/items/telegram_channels`, {
      params: {
        'filter[category_id][_eq]': categoryId,
        'meta': 'total_count',
        'limit': 1
      },
      headers: {
        'Authorization': `Bearer ${DIRECTUS_TOKEN}`
      }
    });
    return response.data.meta.total_count || 0;
  } catch (error) {
    return 0;
  }
}

function runParser(category: string): Promise<number> {
  return new Promise((resolve, reject) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚀 Начинаем парсинг категории: ${category.toUpperCase()}`);
    console.log(`${'='.repeat(60)}\n`);
    
    // БЕЗЛИМИТНЫЙ режим: собираем ВСЕ каналы из категории (лимит 999999)
    const childProcess = spawn('npx', ['tsx', 'scripts/parse-tgstat-puppeteer.ts', category, '999999', '1'], {
      stdio: 'inherit',
      env: { ...process.env }
    });

    childProcess.on('close', (code) => {
      if (code === 0) {
        console.log(`\n✅ Категория ${category} завершена успешно`);
        resolve(0);
      } else {
        console.log(`\n⚠️ Категория ${category} завершена с кодом ${code || 'unknown'}`);
        resolve(code || 1); // Не останавливаем на ошибке, продолжаем
      }
    });

    childProcess.on('error', (error) => {
      console.error(`\n❌ Ошибка при парсинге ${category}:`, error);
      reject(error);
    });
  });
}

async function main() {
  console.log('🎯 БЕЗЛИМИТНЫЙ ПАРСИНГ ВСЕХ КАТЕГОРИЙ TELEGRAM-КАНАЛОВ');
  console.log(`📊 Будет обработано категорий: ${categories.length}`);
  console.log(`⏰ Задержка между категориями: 3-5 минут (защита от блокировки)`);
  console.log(`🚀 РЕЖИМ: ПОЛНЫЙ СБОР (все доступные каналы из каждой категории)\n`);

  const startTime = Date.now();
  let totalParsed = 0;

  for (let i = 0; i < categories.length; i++) {
    const category = categories[i];
    
    try {
      // Парсим категорию
      await runParser(category);
      totalParsed++;
      
      // Задержка между категориями (3-5 минут) для защиты от бана в безлимитном режиме
      // Кроме последней категории
      if (i < categories.length - 1) {
        await randomDelay(3 * 60 * 1000, 5 * 60 * 1000); // 3-5 минут
      }
    } catch (error) {
      console.error(`❌ Критическая ошибка при парсинге ${category}:`, error);
      console.log('⏩ Переходим к следующей категории...');
      
      // Даже при ошибке делаем задержку
      if (i < categories.length - 1) {
        await randomDelay(3 * 60 * 1000, 5 * 60 * 1000);
      }
    }
  }

  const endTime = Date.now();
  const totalMinutes = Math.floor((endTime - startTime) / 60000);

  console.log('\n' + '='.repeat(60));
  console.log('✅ ПАРСИНГ ЗАВЕРШЁН');
  console.log('='.repeat(60));
  console.log(`📊 Обработано категорий: ${totalParsed}/${categories.length}`);
  console.log(`⏱️ Общее время: ${totalMinutes} минут`);
  console.log('='.repeat(60) + '\n');
}

main().catch(console.error);
