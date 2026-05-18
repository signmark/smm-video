import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://directus.nplanner.ru';
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;

if (!DIRECTUS_TOKEN) {
  console.error('❌ DIRECTUS_TOKEN не найден');
  process.exit(1);
}

// Все категории TGStat (со скриншота главной страницы)
const tgstatCategories = [
  { name: 'blogs', name_ru: 'Блоги', name_es: 'Blogs', tgstatUrl: 'https://tgstat.ru/blogs', icon: 'user' },
  { name: 'news', name_ru: 'Новости и СМИ', name_es: 'Noticias', tgstatUrl: 'https://tgstat.ru/news', icon: 'newspaper' },
  { name: 'humor', name_ru: 'Юмор и развлечения', name_es: 'Humor', tgstatUrl: 'https://tgstat.ru/humor', icon: 'smile' },
  { name: 'tech', name_ru: 'Технологии', name_es: 'Tecnologia', tgstatUrl: 'https://tgstat.ru/tech', icon: 'cpu' },
  { name: 'economy', name_ru: 'Экономика', name_es: 'Economia', tgstatUrl: 'https://tgstat.ru/economy', icon: 'trending-up' },
  { name: 'business', name_ru: 'Бизнес и стартапы', name_es: 'Negocios', tgstatUrl: 'https://tgstat.ru/business', icon: 'briefcase' },
  { name: 'crypto', name_ru: 'Криптовалюты', name_es: 'Criptomonedas', tgstatUrl: 'https://tgstat.ru/crypto', icon: 'bitcoin' },
  { name: 'travel', name_ru: 'Путешествия', name_es: 'Viajes', tgstatUrl: 'https://tgstat.ru/travel', icon: 'plane' },
  { name: 'marketing', name_ru: 'Маркетинг, PR, реклама', name_es: 'Marketing', tgstatUrl: 'https://tgstat.ru/marketing', icon: 'megaphone' },
  { name: 'psychology', name_ru: 'Психология', name_es: 'Psicologia', tgstatUrl: 'https://tgstat.ru/psychology', icon: 'brain' },
  { name: 'design', name_ru: 'Дизайн', name_es: 'Diseno', tgstatUrl: 'https://tgstat.ru/design', icon: 'palette' },
  { name: 'politics', name_ru: 'Политика', name_es: 'Politica', tgstatUrl: 'https://tgstat.ru/politics', icon: 'landmark' },
  { name: 'art', name_ru: 'Искусство', name_es: 'Arte', tgstatUrl: 'https://tgstat.ru/art', icon: 'palette' },
  { name: 'law', name_ru: 'Право', name_es: 'Derecho', tgstatUrl: 'https://tgstat.ru/law', icon: 'scale' },
  { name: 'education', name_ru: 'Образование', name_es: 'Educacion', tgstatUrl: 'https://tgstat.ru/education', icon: 'graduation-cap' },
  { name: 'books', name_ru: 'Книги', name_es: 'Libros', tgstatUrl: 'https://tgstat.ru/books', icon: 'book' },
  { name: 'linguistics', name_ru: 'Лингвистика', name_es: 'Linguistica', tgstatUrl: 'https://tgstat.ru/linguistics', icon: 'languages' },
  { name: 'career', name_ru: 'Карьера', name_es: 'Carrera', tgstatUrl: 'https://tgstat.ru/career', icon: 'user-tie' },
  { name: 'educational', name_ru: 'Познавательное', name_es: 'Educativo', tgstatUrl: 'https://tgstat.ru/educational', icon: 'lightbulb' },
  { name: 'courses', name_ru: 'Курсы и гайды', name_es: 'Cursos', tgstatUrl: 'https://tgstat.ru/courses', icon: 'video' },
  { name: 'sport', name_ru: 'Спорт', name_es: 'Deportes', tgstatUrl: 'https://tgstat.ru/sport', icon: 'dumbbell' },
  { name: 'fashion', name_ru: 'Мода и красота', name_es: 'Moda', tgstatUrl: 'https://tgstat.ru/fashion', icon: 'shirt' },
  { name: 'medicine', name_ru: 'Медицина', name_es: 'Medicina', tgstatUrl: 'https://tgstat.ru/medicine', icon: 'stethoscope' },
  { name: 'health', name_ru: 'Здоровье и Фитнес', name_es: 'Salud', tgstatUrl: 'https://tgstat.ru/health', icon: 'heart' },
  { name: 'pictures', name_ru: 'Картинки и фото', name_es: 'Imagenes', tgstatUrl: 'https://tgstat.ru/pictures', icon: 'image' },
  { name: 'software', name_ru: 'Софт и приложения', name_es: 'Software', tgstatUrl: 'https://tgstat.ru/software', icon: 'app-window' },
  { name: 'video', name_ru: 'Видео и фильмы', name_es: 'Video', tgstatUrl: 'https://tgstat.ru/video', icon: 'film' },
  { name: 'music', name_ru: 'Музыка', name_es: 'Musica', tgstatUrl: 'https://tgstat.ru/music', icon: 'music' },
  { name: 'games', name_ru: 'Игры', name_es: 'Juegos', tgstatUrl: 'https://tgstat.ru/games', icon: 'gamepad-2' },
  { name: 'food', name_ru: 'Еда и кулинария', name_es: 'Comida', tgstatUrl: 'https://tgstat.ru/food', icon: 'utensils' },
  { name: 'quotes', name_ru: 'Цитаты', name_es: 'Citas', tgstatUrl: 'https://tgstat.ru/quotes', icon: 'quote' },
  { name: 'crafts', name_ru: 'Рукоделие', name_es: 'Manualidades', tgstatUrl: 'https://tgstat.ru/crafts', icon: 'scissors' },
  { name: 'finance', name_ru: 'Финансы', name_es: 'Finanzas', tgstatUrl: 'https://tgstat.ru/finance', icon: 'dollar-sign' },
  { name: 'entertainment', name_ru: 'Развлечения', name_es: 'Entretenimiento', tgstatUrl: 'https://tgstat.ru/entertainment', icon: 'tv' },
  { name: 'animals', name_ru: 'Природа и животные', name_es: 'Animales', tgstatUrl: 'https://tgstat.ru/animals', icon: 'paw-print' },
  { name: 'auto', name_ru: 'Авто', name_es: 'Autos', tgstatUrl: 'https://tgstat.ru/auto', icon: 'car' },
  { name: 'realestate', name_ru: 'Недвижимость', name_es: 'Inmobiliaria', tgstatUrl: 'https://tgstat.ru/realestate', icon: 'home' },
  { name: 'family', name_ru: 'Семья и дети', name_es: 'Familia', tgstatUrl: 'https://tgstat.ru/family', icon: 'users' },
  { name: 'religion', name_ru: 'Религия', name_es: 'Religion', tgstatUrl: 'https://tgstat.ru/religion', icon: 'church' },
  { name: 'esoteric', name_ru: 'Эзотерика', name_es: 'Esoterico', tgstatUrl: 'https://tgstat.ru/esoteric', icon: 'moon' },
  { name: 'other', name_ru: 'Другое', name_es: 'Otro', tgstatUrl: 'https://tgstat.ru/other', icon: 'folder' },
];

interface DirectusCategory {
  id: string;
  name: string;
  name_ru: string;
}

async function getExistingCategories(): Promise<DirectusCategory[]> {
  try {
    const response = await axios.get(`${DIRECTUS_URL}/items/telegram_categories`, {
      params: { limit: -1, fields: 'id,name,name_ru' },
      headers: { 'Authorization': `Bearer ${DIRECTUS_TOKEN}` }
    });
    return response.data.data || [];
  } catch (error) {
    return [];
  }
}

const DEFAULT_USER_ID = '0de53a42-bd55-4316-aafb-aff6abd73317';

async function createCategory(category: typeof tgstatCategories[0]): Promise<string | null> {
  try {
    const response = await axios.post(`${DIRECTUS_URL}/items/telegram_categories`, {
      name: category.name,
      name_ru: category.name_ru,
      name_en: category.name_ru,
      name_es: category.name_es,
      icon: category.icon,
      description: category.name_ru,
      user_created: DEFAULT_USER_ID
    }, {
      headers: { 
        'Authorization': `Bearer ${DIRECTUS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data.data?.id || null;
  } catch (error: any) {
    console.error(`   Ошибка создания ${category.name}:`, error.response?.data?.errors?.[0]?.message || error.message);
    return null;
  }
}

async function main() {
  console.log('🔄 Синхронизация категорий TGStat с Directus...\n');
  
  const existing = await getExistingCategories();
  console.log(`📦 Существующих категорий в Directus: ${existing.length}`);
  
  const existingNames = new Set(existing.map(c => c.name));
  const missing = tgstatCategories.filter(c => !existingNames.has(c.name));
  
  console.log(`➕ Недостающих категорий: ${missing.length}\n`);
  
  if (missing.length === 0) {
    console.log('✅ Все категории уже есть в базе!');
  } else {
    console.log('Добавляем недостающие категории:\n');
    
    for (const cat of missing) {
      process.stdout.write(`   ${cat.name} (${cat.name_ru})... `);
      const id = await createCategory(cat);
      if (id) {
        console.log(`✅ ${id}`);
      } else {
        console.log('❌');
      }
    }
  }
  
  // Выводим финальный маппинг
  console.log('\n📋 Генерация маппинга для парсера...\n');
  
  const allCategories = await getExistingCategories();
  
  console.log('const categoryMapping: Record<string, { tgstatUrl: string, categoryId: string, categoryName: string }> = {');
  for (const cat of allCategories) {
    const tgCat = tgstatCategories.find(t => t.name === cat.name);
    const url = tgCat?.tgstatUrl || `https://tgstat.ru/${cat.name}`;
    console.log(`  ${cat.name}: { tgstatUrl: '${url}', categoryId: '${cat.id}', categoryName: '${cat.name}' },`);
  }
  console.log('};');
  
  console.log('\n✅ Готово! Скопируйте маппинг в parse-tgstat-puppeteer.ts');
}

main().catch(console.error);
