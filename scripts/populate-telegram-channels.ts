import axios from 'axios';

const DIRECTUS_URL = 'https://directus.nplanner.ru';
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;

interface TelegramChannel {
  username: string;
  name: string;
  category: string;
  subscribers: number;
  avg_post_reach: number;
  engagement_rate: number;
  language: string;
  description?: string;
}

const channels: TelegramChannel[] = [
  // Entertainment (развлечения, спорт, боулинг)
  { username: 'sports_ru', name: 'Спорт России', category: 'entertainment', subscribers: 850000, avg_post_reach: 95000, engagement_rate: 11.2, language: 'ru', description: 'Все о спорте' },
  { username: 'bowling_life', name: 'Боулинг Life', category: 'entertainment', subscribers: 45000, avg_post_reach: 5200, engagement_rate: 11.6, language: 'ru', description: 'Боулинг и активный отдых' },
  { username: 'activesport', name: 'Активный спорт', category: 'entertainment', subscribers: 120000, avg_post_reach: 14000, engagement_rate: 11.7, language: 'ru', description: 'Спорт и активный отдых' },
  { username: 'entertainment_hub', name: 'Центр развлечений', category: 'entertainment', subscribers: 220000, avg_post_reach: 28000, engagement_rate: 12.7, language: 'ru', description: 'Развлечения и досуг' },
  
  // Tech
  { username: 'tproger', name: 'Типичный программист', category: 'tech', subscribers: 280000, avg_post_reach: 32000, engagement_rate: 11.4, language: 'ru', description: 'Технологии и программирование' },
  { username: 'techmind', name: 'TechMind', category: 'tech', subscribers: 195000, avg_post_reach: 23000, engagement_rate: 11.8, language: 'ru', description: 'IT новости и гаджеты' },
  
  // Business
  { username: 'businessru', name: 'Бизнес России', category: 'business', subscribers: 310000, avg_post_reach: 36000, engagement_rate: 11.6, language: 'ru', description: 'Бизнес и предпринимательство' },
  { username: 'startuplife', name: 'Startup Life', category: 'business', subscribers: 175000, avg_post_reach: 21000, engagement_rate: 12.0, language: 'ru', description: 'Стартапы и инвестиции' },
  
  // Marketing
  { username: 'smmexperts', name: 'SMM эксперты', category: 'marketing', subscribers: 145000, avg_post_reach: 17000, engagement_rate: 11.7, language: 'ru', description: 'SMM и маркетинг' },
  { username: 'digitalmarketingru', name: 'Digital маркетинг', category: 'marketing', subscribers: 190000, avg_post_reach: 22000, engagement_rate: 11.6, language: 'ru', description: 'Цифровой маркетинг' },
  
  // Food
  { username: 'foodblogger', name: 'Фуд блогер', category: 'food', subscribers: 260000, avg_post_reach: 31000, engagement_rate: 11.9, language: 'ru', description: 'Еда и рецепты' },
  { username: 'restaurantguide', name: 'Гид по ресторанам', category: 'food', subscribers: 135000, avg_post_reach: 16000, engagement_rate: 11.9, language: 'ru', description: 'Рестораны и кафе' },
  
  // Travel
  { username: 'travelworld', name: 'Мир путешествий', category: 'travel', subscribers: 380000, avg_post_reach: 44000, engagement_rate: 11.6, language: 'ru', description: 'Путешествия по миру' },
  { username: 'adventuretime', name: 'Время приключений', category: 'travel', subscribers: 215000, avg_post_reach: 25000, engagement_rate: 11.6, language: 'ru', description: 'Приключения и туризм' },
  
  // Fashion
  { username: 'fashionista_ru', name: 'Fashionista Russia', category: 'fashion', subscribers: 295000, avg_post_reach: 34000, engagement_rate: 11.5, language: 'ru', description: 'Мода и стиль' },
  { username: 'beautytips', name: 'Советы красоты', category: 'fashion', subscribers: 185000, avg_post_reach: 22000, engagement_rate: 11.9, language: 'ru', description: 'Красота и мода' },
  
  // Health
  { username: 'healthylifestyle', name: 'Здоровый образ жизни', category: 'health', subscribers: 340000, avg_post_reach: 39000, engagement_rate: 11.5, language: 'ru', description: 'ЗОЖ и фитнес' },
  { username: 'fitnesscoach', name: 'Фитнес тренер', category: 'health', subscribers: 205000, avg_post_reach: 24000, engagement_rate: 11.7, language: 'ru', description: 'Фитнес и здоровье' },
  
  // Finance
  { username: 'financeexpert', name: 'Финансовый эксперт', category: 'finance', subscribers: 275000, avg_post_reach: 32000, engagement_rate: 11.6, language: 'ru', description: 'Финансы и инвестиции' },
  { username: 'investpro', name: 'Инвест Про', category: 'finance', subscribers: 195000, avg_post_reach: 23000, engagement_rate: 11.8, language: 'ru', description: 'Инвестиции и накопления' },
  
  // Education
  { username: 'eduplatform', name: 'Образовательная платформа', category: 'education', subscribers: 225000, avg_post_reach: 26000, engagement_rate: 11.6, language: 'ru', description: 'Образование и курсы' },
  { username: 'learnonline', name: 'Учись онлайн', category: 'education', subscribers: 165000, avg_post_reach: 19000, engagement_rate: 11.5, language: 'ru', description: 'Онлайн обучение' },
  
  // News
  { username: 'newstoday', name: 'Новости сегодня', category: 'news', subscribers: 520000, avg_post_reach: 60000, engagement_rate: 11.5, language: 'ru', description: 'Актуальные новости' },
  { username: 'dailynews', name: 'Ежедневные новости', category: 'news', subscribers: 395000, avg_post_reach: 46000, engagement_rate: 11.6, language: 'ru', description: 'Новости дня' },
  
  // Crypto
  { username: 'cryptonews', name: 'Крипто новости', category: 'crypto', subscribers: 285000, avg_post_reach: 33000, engagement_rate: 11.6, language: 'ru', description: 'Криптовалюты и блокчейн' },
  { username: 'bitcoinru', name: 'Bitcoin Russia', category: 'crypto', subscribers: 245000, avg_post_reach: 29000, engagement_rate: 11.8, language: 'ru', description: 'Bitcoin и криптовалюты' },
];

async function populateChannels() {
  console.log('🚀 Начинаем заполнение базы Telegram-каналами...');
  
  let successCount = 0;
  let errorCount = 0;
  
  for (const channel of channels) {
    try {
      const response = await axios.post(
        `${DIRECTUS_URL}/items/telegram_channels`,
        channel,
        {
          headers: {
            'Authorization': `Bearer ${DIRECTUS_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (response.data?.data) {
        successCount++;
        console.log(`✅ Добавлен канал: @${channel.username} (${channel.category})`);
      }
    } catch (error: any) {
      errorCount++;
      console.error(`❌ Ошибка при добавлении @${channel.username}:`, error.response?.data?.errors?.[0]?.message || error.message);
    }
  }
  
  console.log(`\n📊 Итого:`);
  console.log(`✅ Успешно добавлено: ${successCount}`);
  console.log(`❌ Ошибок: ${errorCount}`);
}

populateChannels();
