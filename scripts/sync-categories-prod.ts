import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env'), override: true });

const DIRECTUS_URL = 'https://directus.nplanner.ru';
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;

const newCategories = [
  { slug: 'edutainment', name: 'Познавательное', name_ru: 'Познавательное', name_en: 'Edutainment', name_es: 'Educativo' },
  { slug: 'sales', name: 'Продажи', name_ru: 'Продажи', name_en: 'Sales', name_es: 'Ventas' },
  { slug: 'nature', name: 'Природа', name_ru: 'Природа', name_en: 'Nature', name_es: 'Naturaleza' },
  { slug: 'babies', name: 'Дети и родители', name_ru: 'Дети и родители', name_en: 'Babies & Parenting', name_es: 'Bebés y Padres' },
  { slug: 'construction', name: 'Строительство', name_ru: 'Строительство', name_en: 'Construction', name_es: 'Construcción' },
  { slug: 'transport', name: 'Транспорт', name_ru: 'Транспорт', name_en: 'Transport', name_es: 'Transporte' },
  { slug: 'religion', name: 'Религия', name_ru: 'Религия', name_en: 'Religion', name_es: 'Religión' },
  { slug: 'telegram', name: 'Telegram', name_ru: 'Telegram', name_en: 'Telegram', name_es: 'Telegram' },
];

async function createNewCategories() {
  console.log('🔄 Создание новых категорий в Directus PROD...\n');
  
  for (const cat of newCategories) {
    try {
      const res = await axios.post(`${DIRECTUS_URL}/items/telegram_categories`, {
        slug: cat.slug,
        name: cat.name,
        name_ru: cat.name_ru,
        name_en: cat.name_en,
        name_es: cat.name_es,
        description: cat.name,
        icon: 'folder'
      }, { headers: { 'Authorization': `Bearer ${DIRECTUS_TOKEN}` } });
      console.log(`  ✅ ${cat.slug}: создано (id: ${res.data.data.id})`);
    } catch (e: any) {
      console.log(`  ❌ ${cat.slug}: ${e.response?.data?.errors?.[0]?.message || e.message}`);
    }
  }
  
  console.log('\n✅ Готово!');
}

createNewCategories().catch(console.error);
