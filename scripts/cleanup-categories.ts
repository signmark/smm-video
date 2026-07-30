import axios from 'axios';

const TOKEN = process.env.DIRECTUS_ADMIN_TOKEN;
if (!TOKEN) throw new Error('DIRECTUS_ADMIN_TOKEN не задан');
const URL = 'https://directus.nplanner.ru';

const keepCategories = new Set([
  'blogs', 'news', 'humor', 'tech', 'economy', 'business', 'crypto', 'travel',
  'marketing', 'psychology', 'design', 'politics', 'art', 'law', 'education', 'books',
  'linguistics', 'career', 'educational', 'courses', 'sport', 'fashion', 'medicine', 'health',
  'pictures', 'software', 'video', 'music', 'games', 'food', 'quotes', 'crafts',
  'animals', 'auto', 'realestate', 'family', 'religion', 'esoteric', 'other', 'finance', 'entertainment'
]);

async function main() {
  const res = await axios.get(`${URL}/items/telegram_categories?limit=100&fields=id,name`, {
    headers: { 'Authorization': `Bearer ${TOKEN}` }
  });
  
  const toDelete = res.data.data.filter((c: any) => !keepCategories.has(c.name));
  console.log('Категории для удаления:', toDelete.length);
  console.log(toDelete.map((c: any) => c.name).join(', '));
  
  for (const cat of toDelete) {
    try {
      await axios.delete(`${URL}/items/telegram_categories/${cat.id}`, {
        headers: { 'Authorization': `Bearer ${TOKEN}` }
      });
      console.log(`✅ Удалено: ${cat.name}`);
    } catch (e: any) {
      console.log(`❌ Ошибка ${cat.name}: ${e.response?.data?.errors?.[0]?.message || e.message}`);
    }
  }
  
  const final = await axios.get(`${URL}/items/telegram_categories?meta=total_count&limit=1`, {
    headers: { 'Authorization': `Bearer ${TOKEN}` }
  });
  console.log('\nОсталось категорий:', final.data.meta.total_count);
}

main();
