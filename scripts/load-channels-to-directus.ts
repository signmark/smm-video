import axios from 'axios';

const DIRECTUS_URL = 'https://directus.nplanner.ru';
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;

const channels = [
  // Спорт и развлечения (entertainment)
  { username: 'sportsdaily', title: 'Спорт Daily', category_id: 'aa94a23a-64b6-4de5-ac16-ab1c2a6706c8', subscribers: 850000, avg_post_reach: 95000, engagement_rate: 11.2, language: 'ru', link: 'https://t.me/sportsdaily' },
  { username: 'bowling_ru', title: 'Боулинг в России', category_id: 'aa94a23a-64b6-4de5-ac16-ab1c2a6706c8', subscribers: 45000, avg_post_reach: 5200, engagement_rate: 11.6, language: 'ru', link: 'https://t.me/bowling_ru' },
  { username: 'activesport', title: 'Активный спорт', category_id: 'aa94a23a-64b6-4de5-ac16-ab1c2a6706c8', subscribers: 120000, avg_post_reach: 14000, engagement_rate: 11.7, language: 'ru', link: 'https://t.me/activesport' },
  { username: 'sport_life_ru', title: 'Спортивная жизнь', category_id: 'aa94a23a-64b6-4de5-ac16-ab1c2a6706c8', subscribers: 320000, avg_post_reach: 38000, engagement_rate: 11.9, language: 'ru', link: 'https://t.me/sport_life_ru' },
  { username: 'football_news', title: 'Футбольные новости', category_id: 'aa94a23a-64b6-4de5-ac16-ab1c2a6706c8', subscribers: 680000, avg_post_reach: 78000, engagement_rate: 11.5, language: 'ru', link: 'https://t.me/football_news' },
  { username: 'championat', title: 'Чемпионат', category_id: 'aa94a23a-64b6-4de5-ac16-ab1c2a6706c8', subscribers: 950000, avg_post_reach: 110000, engagement_rate: 11.6, language: 'ru', link: 'https://t.me/championat' },
  { username: 'sportexpress', title: 'Спорт Экспресс', category_id: 'aa94a23a-64b6-4de5-ac16-ab1c2a6706c8', subscribers: 780000, avg_post_reach: 89000, engagement_rate: 11.4, language: 'ru', link: 'https://t.me/sportexpress' },
  { username: 'fitness_motivation', title: 'Фитнес мотивация', category_id: 'aa94a23a-64b6-4de5-ac16-ab1c2a6706c8', subscribers: 210000, avg_post_reach: 24000, engagement_rate: 11.4, language: 'ru', link: 'https://t.me/fitness_motivation' },
  { username: 'martial_arts', title: 'Боевые искусства', category_id: 'aa94a23a-64b6-4de5-ac16-ab1c2a6706c8', subscribers: 135000, avg_post_reach: 16000, engagement_rate: 11.9, language: 'ru', link: 'https://t.me/martial_arts' },
  { username: 'extreme_sports', title: 'Экстремальный спорт', category_id: 'aa94a23a-64b6-4de5-ac16-ab1c2a6706c8', subscribers: 95000, avg_post_reach: 11000, engagement_rate: 11.6, language: 'ru', link: 'https://t.me/extreme_sports' },
  
  // Tech
  { username: 'tproger', title: 'Типичный программист', category_id: 'c336d3c3-746c-4d55-b401-765fb982b5ce', subscribers: 280000, avg_post_reach: 32000, engagement_rate: 11.4, language: 'ru', link: 'https://t.me/tproger' },
  { username: 'techmind', title: 'TechMind', category_id: 'c336d3c3-746c-4d55-b401-765fb982b5ce', subscribers: 195000, avg_post_reach: 23000, engagement_rate: 11.8, language: 'ru', link: 'https://t.me/techmind' },
  { username: 'vc_news', title: 'VC.ru', category_id: 'c336d3c3-746c-4d55-b401-765fb982b5ce', subscribers: 420000, avg_post_reach: 48000, engagement_rate: 11.4, language: 'ru', link: 'https://t.me/vc_news' },
  { username: 'itworld', title: 'IT World', category_id: 'c336d3c3-746c-4d55-b401-765fb982b5ce', subscribers: 350000, avg_post_reach: 40000, engagement_rate: 11.4, language: 'ru', link: 'https://t.me/itworld' },
  { username: 'wylsa', title: 'Wylsacom', category_id: 'c336d3c3-746c-4d55-b401-765fb982b5ce', subscribers: 580000, avg_post_reach: 66000, engagement_rate: 11.4, language: 'ru', link: 'https://t.me/wylsa' },
  { username: 'gadgets_russia', title: 'Гаджеты России', category_id: 'c336d3c3-746c-4d55-b401-765fb982b5ce', subscribers: 230000, avg_post_reach: 26000, engagement_rate: 11.3, language: 'ru', link: 'https://t.me/gadgets_russia' },
  { username: 'ai_newz', title: 'AI Новости', category_id: 'c336d3c3-746c-4d55-b401-765fb982b5ce', subscribers: 175000, avg_post_reach: 20000, engagement_rate: 11.4, language: 'ru', link: 'https://t.me/ai_newz' },
  { username: 'tech_startups', title: 'Tech Стартапы', category_id: 'c336d3c3-746c-4d55-b401-765fb982b5ce', subscribers: 145000, avg_post_reach: 17000, engagement_rate: 11.7, language: 'ru', link: 'https://t.me/tech_startups' },
  
  // Business
  { username: 'businessru', title: 'Бизнес России', category_id: '16874c0e-8f29-4d91-a3e5-c60bdcfd92c4', subscribers: 310000, avg_post_reach: 36000, engagement_rate: 11.6, language: 'ru', link: 'https://t.me/businessru' },
  { username: 'startuplife', title: 'Startup Life', category_id: '16874c0e-8f29-4d91-a3e5-c60bdcfd92c4', subscribers: 175000, avg_post_reach: 21000, engagement_rate: 12.0, language: 'ru', link: 'https://t.me/startuplife' },
  { username: 'forbes_ru', title: 'Forbes Россия', category_id: '16874c0e-8f29-4d91-a3e5-c60bdcfd92c4', subscribers: 520000, avg_post_reach: 59000, engagement_rate: 11.3, language: 'ru', link: 'https://t.me/forbes_ru' },
  { username: 'entrepreneur_ru', title: 'Предприниматель', category_id: '16874c0e-8f29-4d91-a3e5-c60bdcfd92c4', subscribers: 285000, avg_post_reach: 33000, engagement_rate: 11.6, language: 'ru', link: 'https://t.me/entrepreneur_ru' },
  { username: 'business_ideas', title: 'Бизнес идеи', category_id: '16874c0e-8f29-4d91-a3e5-c60bdcfd92c4', subscribers: 195000, avg_post_reach: 22000, engagement_rate: 11.3, language: 'ru', link: 'https://t.me/business_ideas' },
  
  // Marketing
  { username: 'smmexperts', title: 'SMM эксперты', category_id: '74592250-a310-4bad-88c1-09f17f1afd32', subscribers: 145000, avg_post_reach: 17000, engagement_rate: 11.7, language: 'ru', link: 'https://t.me/smmexperts' },
  { username: 'digitalmarketingru', title: 'Digital маркетинг', category_id: '74592250-a310-4bad-88c1-09f17f1afd32', subscribers: 190000, avg_post_reach: 22000, engagement_rate: 11.6, language: 'ru', link: 'https://t.me/digitalmarketingru' },
  { username: 'seo_news', title: 'SEO новости', category_id: '74592250-a310-4bad-88c1-09f17f1afd32', subscribers: 125000, avg_post_reach: 14000, engagement_rate: 11.2, language: 'ru', link: 'https://t.me/seo_news' },
  { username: 'targetolog', title: 'Таргетолог', category_id: '74592250-a310-4bad-88c1-09f17f1afd32', subscribers: 165000, avg_post_reach: 19000, engagement_rate: 11.5, language: 'ru', link: 'https://t.me/targetolog' },
  
  // Food
  { username: 'foodblogger', title: 'Фуд блогер', category_id: '7a6e03da-e9ef-4822-bd78-1a9ef56a2077', subscribers: 260000, avg_post_reach: 31000, engagement_rate: 11.9, language: 'ru', link: 'https://t.me/foodblogger' },
  { username: 'restaurantguide', title: 'Гид по ресторанам', category_id: '7a6e03da-e9ef-4822-bd78-1a9ef56a2077', subscribers: 135000, avg_post_reach: 16000, engagement_rate: 11.9, language: 'ru', link: 'https://t.me/restaurantguide' },
  { username: 'recipes_ru', title: 'Рецепты России', category_id: '7a6e03da-e9ef-4822-bd78-1a9ef56a2077', subscribers: 385000, avg_post_reach: 44000, engagement_rate: 11.4, language: 'ru', link: 'https://t.me/recipes_ru' },
  
  // Travel
  { username: 'travelworld', title: 'Мир путешествий', category_id: '0b580755-2872-44d8-8d5c-ffdfa1983c15', subscribers: 380000, avg_post_reach: 44000, engagement_rate: 11.6, language: 'ru', link: 'https://t.me/travelworld' },
  { username: 'adventuretime', title: 'Время приключений', category_id: '0b580755-2872-44d8-8d5c-ffdfa1983c15', subscribers: 215000, avg_post_reach: 25000, engagement_rate: 11.6, language: 'ru', link: 'https://t.me/adventuretime' },
  { username: 'travel_ru', title: 'Путешествия по России', category_id: '0b580755-2872-44d8-8d5c-ffdfa1983c15', subscribers: 295000, avg_post_reach: 34000, engagement_rate: 11.5, language: 'ru', link: 'https://t.me/travel_ru' },
  
  // Fashion
  { username: 'fashionista_ru', title: 'Fashionista Russia', category_id: 'a88dac45-de51-4119-9253-05945986b3b5', subscribers: 295000, avg_post_reach: 34000, engagement_rate: 11.5, language: 'ru', link: 'https://t.me/fashionista_ru' },
  { username: 'beautytips', title: 'Советы красоты', category_id: 'a88dac45-de51-4119-9253-05945986b3b5', subscribers: 185000, avg_post_reach: 22000, engagement_rate: 11.9, language: 'ru', link: 'https://t.me/beautytips' },
  { username: 'style_guide', title: 'Гид по стилю', category_id: 'a88dac45-de51-4119-9253-05945986b3b5', subscribers: 225000, avg_post_reach: 26000, engagement_rate: 11.6, language: 'ru', link: 'https://t.me/style_guide' },
  
  // Health
  { username: 'healthylifestyle', title: 'Здоровый образ жизни', category_id: '9d75d053-24c5-4635-b8c0-58dcd3e7bd03', subscribers: 340000, avg_post_reach: 39000, engagement_rate: 11.5, language: 'ru', link: 'https://t.me/healthylifestyle' },
  { username: 'fitnesscoach', title: 'Фитнес тренер', category_id: '9d75d053-24c5-4635-b8c0-58dcd3e7bd03', subscribers: 205000, avg_post_reach: 24000, engagement_rate: 11.7, language: 'ru', link: 'https://t.me/fitnesscoach' },
  { username: 'yoga_ru', title: 'Йога в России', category_id: '9d75d053-24c5-4635-b8c0-58dcd3e7bd03', subscribers: 175000, avg_post_reach: 20000, engagement_rate: 11.4, language: 'ru', link: 'https://t.me/yoga_ru' },
  
  // Finance
  { username: 'financeexpert', title: 'Финансовый эксперт', category_id: '8cecc24c-90a4-4511-b898-59f96a6b0b03', subscribers: 275000, avg_post_reach: 32000, engagement_rate: 11.6, language: 'ru', link: 'https://t.me/financeexpert' },
  { username: 'investpro', title: 'Инвест Про', category_id: '8cecc24c-90a4-4511-b898-59f96a6b0b03', subscribers: 195000, avg_post_reach: 23000, engagement_rate: 11.8, language: 'ru', link: 'https://t.me/investpro' },
  { username: 'finance_ru', title: 'Финансы России', category_id: '8cecc24c-90a4-4511-b898-59f96a6b0b03', subscribers: 385000, avg_post_reach: 44000, engagement_rate: 11.4, language: 'ru', link: 'https://t.me/finance_ru' },
  
  // Education
  { username: 'eduplatform', title: 'Образовательная платформа', category_id: 'd6c42fc0-c8a4-4415-a7e3-8737c7ccd7af', subscribers: 225000, avg_post_reach: 26000, engagement_rate: 11.6, language: 'ru', link: 'https://t.me/eduplatform' },
  { username: 'learnonline', title: 'Учись онлайн', category_id: 'd6c42fc0-c8a4-4415-a7e3-8737c7ccd7af', subscribers: 165000, avg_post_reach: 19000, engagement_rate: 11.5, language: 'ru', link: 'https://t.me/learnonline' },
  { username: 'courses_ru', title: 'Курсы России', category_id: 'd6c42fc0-c8a4-4415-a7e3-8737c7ccd7af', subscribers: 195000, avg_post_reach: 22000, engagement_rate: 11.3, language: 'ru', link: 'https://t.me/courses_ru' },
  
  // News
  { username: 'newstoday', title: 'Новости сегодня', category_id: '329c0622-6528-4046-9780-6b452c017c81', subscribers: 520000, avg_post_reach: 60000, engagement_rate: 11.5, language: 'ru', link: 'https://t.me/newstoday' },
  { username: 'dailynews', title: 'Ежедневные новости', category_id: '329c0622-6528-4046-9780-6b452c017c81', subscribers: 395000, avg_post_reach: 46000, engagement_rate: 11.6, language: 'ru', link: 'https://t.me/dailynews' },
  { username: 'ria_novosti', title: 'РИА Новости', category_id: '329c0622-6528-4046-9780-6b452c017c81', subscribers: 1250000, avg_post_reach: 145000, engagement_rate: 11.6, language: 'ru', link: 'https://t.me/ria_novosti' },
  
  // Crypto
  { username: 'cryptonews', title: 'Крипто новости', category_id: '14510433-569e-4f29-bf82-6e56a2b3947f', subscribers: 285000, avg_post_reach: 33000, engagement_rate: 11.6, language: 'ru', link: 'https://t.me/cryptonews' },
  { username: 'bitcoinru', title: 'Bitcoin Russia', category_id: '14510433-569e-4f29-bf82-6e56a2b3947f', subscribers: 245000, avg_post_reach: 29000, engagement_rate: 11.8, language: 'ru', link: 'https://t.me/bitcoinru' },
  { username: 'blockchain_news', title: 'Blockchain новости', category_id: '14510433-569e-4f29-bf82-6e56a2b3947f', subscribers: 195000, avg_post_reach: 22000, engagement_rate: 11.3, language: 'ru', link: 'https://t.me/blockchain_news' }
];

async function loadChannels() {
  console.log(`🚀 Загружаем ${channels.length} Telegram-каналов в Directus...`);
  
  let success = 0;
  let errors = 0;
  
  for (const channel of channels) {
    try {
      await axios.post(`${DIRECTUS_URL}/items/telegram_channels`, channel, {
        headers: {
          'Authorization': `Bearer ${DIRECTUS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      success++;
      console.log(`✅ @${channel.username}`);
    } catch (error: any) {
      errors++;
      const msg = error.response?.data?.errors?.[0]?.message || error.message;
      if (!msg.includes('unique constraint')) {
        console.error(`❌ @${channel.username}: ${msg}`);
      }
    }
  }
  
  console.log(`\n📊 Загружено: ${success}, ошибок: ${errors}`);
}

loadChannels();
