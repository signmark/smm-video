import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env'), override: true });

const DIRECTUS_URL = 'https://directus.nplanner.ru';
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;

// Маппинг name -> slug (TGStat URL слаги)
const slugMap: Record<string, string> = {
  'Блоги': 'blogs',
  'Новости и СМИ': 'news',
  'Юмор и развлечения': 'entertainment',
  'Технологии': 'tech',
  'Экономика': 'economics',
  'Бизнес и стартапы': 'business',
  'Криптовалюты': 'crypto',
  'Путешествия': 'travels',
  'Маркетинг, PR, реклама': 'marketing',
  'Психология': 'psychology',
  'Дизайн': 'design',
  'Политика': 'politics',
  'Искусство': 'art',
  'Право': 'law',
  'Образование': 'education',
  'Книги': 'books',
  'Лингвистика': 'language',
  'Карьера': 'career',
  'Познавательное': 'edutainment',
  'Курсы и гайды': 'courses',
  'Спорт': 'sport',
  'Мода и красота': 'beauty',
  'Медицина': 'medicine',
  'Здоровье и Фитнес': 'health',
  'Картинки и фото': 'pics',
  'Софт и приложения': 'apps',
  'Видео и фильмы': 'video',
  'Музыка': 'music',
  'Игры': 'games',
  'Еда и кулинария': 'food',
  'Цитаты': 'quotes',
  'Рукоделие': 'handmade',
  'Продажи': 'sales',
  'Природа': 'nature',
  'Дети и родители': 'babies',
  'Строительство': 'construction',
  'Транспорт': 'transport',
  'Религия': 'religion',
  'Instagram': 'instagram',
  'Telegram': 'telegram',
  // Англоязычные name
  'entertainment': 'entertainment',
  'finance': 'finance',
  'educational': 'educational',
  'realestate': 'realestate',
  'animals': 'animals',
  'auto': 'auto',
  'esoteric': 'esoteric',
  'other': 'other',
  'religion': 'religion',
};

async function fillSlugs() {
  console.log('🔄 Заполняем поле slug для категорий...\n');
  
  // Получаем все категории
  const res = await axios.get(`${DIRECTUS_URL}/items/telegram_categories?limit=100`, {
    headers: { 'Authorization': `Bearer ${DIRECTUS_TOKEN}` }
  });
  
  const categories = res.data.data;
  let updated = 0, skipped = 0;
  
  for (const cat of categories) {
    const slug = slugMap[cat.name];
    if (!slug) {
      console.log(`  ⚠️ ${cat.name}: нет маппинга`);
      skipped++;
      continue;
    }
    
    if (cat.slug === slug) {
      skipped++;
      continue;
    }
    
    try {
      await axios.patch(`${DIRECTUS_URL}/items/telegram_categories/${cat.id}`, 
        { slug }, 
        { headers: { 'Authorization': `Bearer ${DIRECTUS_TOKEN}` } }
      );
      console.log(`  ✅ ${cat.name} -> ${slug}`);
      updated++;
    } catch (e: any) {
      console.log(`  ❌ ${cat.name}: ${e.response?.data?.errors?.[0]?.message || e.message}`);
    }
  }
  
  console.log(`\n📊 Обновлено: ${updated}, пропущено: ${skipped}`);
}

fillSlugs().catch(console.error);
