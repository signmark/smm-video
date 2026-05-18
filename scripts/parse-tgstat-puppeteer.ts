import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { ensureAuthenticated, loadCookies, checkAuth } from './tgstat-auth';

// Загружаем переменные окружения из .env (override: true перезаписывает системные)
dotenv.config({ path: path.join(process.cwd(), '.env'), override: true });

// Проверяем загрузку токена (без вывода значения)
if (!process.env.DIRECTUS_TOKEN) {
  console.error('⚠️ DIRECTUS_TOKEN не найден!');
}


// Файл для сохранения прогресса
const PROGRESS_FILE = path.join(process.cwd(), 'tgstat-progress.json');

interface ProgressData {
  completedCategories: string[];
  lastUpdated: string;
}

function loadProgress(): ProgressData {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      const data = fs.readFileSync(PROGRESS_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.log('⚠️ Не удалось загрузить прогресс, начинаем сначала');
  }
  return { completedCategories: [], lastUpdated: new Date().toISOString() };
}

function saveProgress(completedCategories: string[]): void {
  const data: ProgressData = {
    completedCategories,
    lastUpdated: new Date().toISOString()
  };
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data, null, 2));
  console.log(`💾 Прогресс сохранён: ${completedCategories.length} категорий завершено`);
}

function markCategoryCompleted(category: string): void {
  const progress = loadProgress();
  if (!progress.completedCategories.includes(category)) {
    progress.completedCategories.push(category);
    saveProgress(progress.completedCategories);
  }
}

function isCategoryCompleted(category: string): boolean {
  const progress = loadProgress();
  return progress.completedCategories.includes(category);
}

// Включаем stealth-режим для обхода Cloudflare
puppeteer.use(StealthPlugin());

const DIRECTUS_URL = 'https://directus.nplanner.ru';
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;

if (!DIRECTUS_TOKEN) {
  console.error('❌ ОШИБКА: DIRECTUS_TOKEN не найден в переменных окружения!');
  console.error('   Убедитесь, что файл .env содержит DIRECTUS_TOKEN');
  process.exit(1);
}

// Маппинг категорий TGStat -> Directus (PROD)
// Актуальные ID из Directus, slug = URL на tgstat.ru (проверено 15.12.2024)
const categoryMapping: Record<string, { tgstatUrl: string, categoryId: string, categoryName: string }> = {
  apps: { tgstatUrl: 'https://tgstat.ru/apps', categoryId: 'a1b2c3d4-0019-4001-8001-000000000019', categoryName: 'Софт и приложения' },
  art: { tgstatUrl: 'https://tgstat.ru/art', categoryId: 'a1b2c3d4-0010-4001-8001-000000000010', categoryName: 'Искусство' },
  babies: { tgstatUrl: 'https://tgstat.ru/babies', categoryId: 'e3ad525c-0127-4b89-9201-80961a78ae9c', categoryName: 'Дети и родители' },
  beauty: { tgstatUrl: 'https://tgstat.ru/beauty', categoryId: 'c37dd43f-9989-4025-a78c-97a5a9e07f97', categoryName: 'Мода и красота' },
  blogs: { tgstatUrl: 'https://tgstat.ru/blogs', categoryId: 'a1b2c3d4-0001-4001-8001-000000000001', categoryName: 'Блоги' },
  books: { tgstatUrl: 'https://tgstat.ru/books', categoryId: 'a1b2c3d4-0013-4001-8001-000000000013', categoryName: 'Книги' },
  business: { tgstatUrl: 'https://tgstat.ru/business', categoryId: '40d10a02-8a25-42f3-993d-10e869b6597e', categoryName: 'Бизнес и стартапы' },
  career: { tgstatUrl: 'https://tgstat.ru/career', categoryId: 'a1b2c3d4-0014-4001-8001-000000000014', categoryName: 'Карьера' },
  construction: { tgstatUrl: 'https://tgstat.ru/construction', categoryId: 'dd9daaac-b4a9-4da1-afc8-2ebe0324a1db', categoryName: 'Строительство' },
  courses: { tgstatUrl: 'https://tgstat.ru/courses', categoryId: 'a1b2c3d4-0021-4001-8001-000000000021', categoryName: 'Курсы и гайды' },
  crypto: { tgstatUrl: 'https://tgstat.ru/crypto', categoryId: 'c9010742-0ddc-41ad-806f-30c05cdae727', categoryName: 'Криптовалюты' },
  design: { tgstatUrl: 'https://tgstat.ru/design', categoryId: 'a1b2c3d4-0016-4001-8001-000000000016', categoryName: 'Дизайн' },
  economics: { tgstatUrl: 'https://tgstat.ru/economics', categoryId: 'a1b2c3d4-0012-4001-8001-000000000012', categoryName: 'Экономика' },
  education: { tgstatUrl: 'https://tgstat.ru/education', categoryId: '35ed901c-d666-4075-a7c5-07cbb581e5cf', categoryName: 'Образование' },
  edutainment: { tgstatUrl: 'https://tgstat.ru/edutainment', categoryId: '6e6b5063-203c-4912-b549-502fe4c07ee4', categoryName: 'Познавательное' },
  entertainment: { tgstatUrl: 'https://tgstat.ru/entertainment', categoryId: 'a1b2c3d4-0002-4001-8001-000000000002', categoryName: 'Юмор и развлечения' },
  food: { tgstatUrl: 'https://tgstat.ru/food', categoryId: '048066b5-481b-4186-b7c3-fb3532a07892', categoryName: 'Еда и кулинария' },
  games: { tgstatUrl: 'https://tgstat.ru/games', categoryId: 'a1b2c3d4-0003-4001-8001-000000000003', categoryName: 'Игры' },
  handmade: { tgstatUrl: 'https://tgstat.ru/handmade', categoryId: 'a1b2c3d4-0018-4001-8001-000000000018', categoryName: 'Рукоделие' },
  health: { tgstatUrl: 'https://tgstat.ru/health', categoryId: 'e6eb9f3f-db6e-4461-8412-11c22c552c8f', categoryName: 'Здоровье и Фитнес' },
  instagram: { tgstatUrl: 'https://tgstat.ru/instagram', categoryId: 'a1b2c3d4-0029-4001-8001-000000000029', categoryName: 'Instagram' },
  language: { tgstatUrl: 'https://tgstat.ru/language', categoryId: 'a1b2c3d4-0017-4001-8001-000000000017', categoryName: 'Лингвистика' },
  law: { tgstatUrl: 'https://tgstat.ru/law', categoryId: 'a1b2c3d4-0020-4001-8001-000000000020', categoryName: 'Право' },
  marketing: { tgstatUrl: 'https://tgstat.ru/marketing', categoryId: 'fe2ec617-79d9-4d03-9bce-1ae84422ca1d', categoryName: 'Маркетинг, PR, реклама' },
  medicine: { tgstatUrl: 'https://tgstat.ru/medicine', categoryId: 'a1b2c3d4-0015-4001-8001-000000000015', categoryName: 'Медицина' },
  music: { tgstatUrl: 'https://tgstat.ru/music', categoryId: 'a1b2c3d4-0006-4001-8001-000000000006', categoryName: 'Музыка' },
  nature: { tgstatUrl: 'https://tgstat.ru/nature', categoryId: '7de7a413-c582-4ae8-9330-a8c02f41b7a1', categoryName: 'Природа' },
  news: { tgstatUrl: 'https://tgstat.ru/news', categoryId: '8894d5ba-94da-4c18-bc9d-fba8e5742e91', categoryName: 'Новости и СМИ' },
  pics: { tgstatUrl: 'https://tgstat.ru/pics', categoryId: 'a1b2c3d4-0004-4001-8001-000000000004', categoryName: 'Картинки и фото' },
  politics: { tgstatUrl: 'https://tgstat.ru/politics', categoryId: 'a1b2c3d4-0011-4001-8001-000000000011', categoryName: 'Политика' },
  psychology: { tgstatUrl: 'https://tgstat.ru/psychology', categoryId: 'a1b2c3d4-0005-4001-8001-000000000005', categoryName: 'Психология' },
  quotes: { tgstatUrl: 'https://tgstat.ru/quotes', categoryId: 'a1b2c3d4-0007-4001-8001-000000000007', categoryName: 'Цитаты' },
  religion: { tgstatUrl: 'https://tgstat.ru/religion', categoryId: '064a5882-0cb4-4776-b54a-d2c7a2bc4272', categoryName: 'Религия' },
  sales: { tgstatUrl: 'https://tgstat.ru/sales', categoryId: '7f8db52b-8f76-478a-81d6-e56613ddd249', categoryName: 'Продажи' },
  sport: { tgstatUrl: 'https://tgstat.ru/sport', categoryId: '7593cc3b-5a1a-4c88-aae7-1c5ea0b968f4', categoryName: 'Спорт' },
  tech: { tgstatUrl: 'https://tgstat.ru/tech', categoryId: 'd896d488-62c6-483c-9b9d-b908284d5d79', categoryName: 'Технологии' },
  telegram: { tgstatUrl: 'https://tgstat.ru/telegram', categoryId: 'f787adbd-2480-4e2d-a441-44cbe20e8bbd', categoryName: 'Telegram' },
  transport: { tgstatUrl: 'https://tgstat.ru/transport', categoryId: 'b60e2405-5043-4af8-a5d8-e2ebd402180a', categoryName: 'Транспорт' },
  travels: { tgstatUrl: 'https://tgstat.ru/travels', categoryId: '648f0f29-2ac7-4c78-8607-8db2ca158d6c', categoryName: 'Путешествия' },
  video: { tgstatUrl: 'https://tgstat.ru/video', categoryId: 'a1b2c3d4-0008-4001-8001-000000000008', categoryName: 'Видео и фильмы' },
  other: { tgstatUrl: 'https://tgstat.ru/other', categoryId: 'a1b2c3d4-0043-4001-8001-000000000043', categoryName: 'Другое' },
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

async function randomDelay(min: number, max: number) {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  await new Promise(resolve => setTimeout(resolve, delay));
}

// Список User-Agent для ротации (имитация разных браузеров) - Chrome 142.x (декабрь 2024)
const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'
];

const getRandomUserAgent = () => userAgents[Math.floor(Math.random() * userAgents.length)];

async function simulateHumanBehavior(page: any) {
  // Случайные движения мыши (как человек водит курсором)
  const viewport = page.viewport();
  if (viewport) {
    const x = Math.random() * viewport.width * 0.8 + viewport.width * 0.1;
    const y = Math.random() * viewport.height * 0.6 + viewport.height * 0.2;
    await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 10) + 5 });
  }
  await randomDelay(300, 800);
  
  // Случайный скроллинг
  await page.evaluate(() => {
    window.scrollBy(0, Math.random() * 500 + 200);
  });
  await randomDelay(1000, 2000);
  
  // Ещё движение мыши
  if (viewport) {
    const x2 = Math.random() * viewport.width * 0.7;
    const y2 = Math.random() * viewport.height * 0.5;
    await page.mouse.move(x2, y2, { steps: Math.floor(Math.random() * 8) + 3 });
  }
  await randomDelay(500, 1000);
  
  // Ещё скроллинг
  await page.evaluate(() => {
    window.scrollBy(0, Math.random() * 300 + 100);
  });
  await randomDelay(800, 1500);
}

// Вспомогательная функция для извлечения каналов из страницы
// Поддержка новой структуры TGStat (2024+) и старой
async function extractChannelsFromPage(page: any, config: { categoryId: string, categoryName: string }): Promise<ParsedChannel[]> {
  const channelsData = await page.evaluate(() => {
    const channels: any[] = [];
    const seen = new Set<string>();
    
    // Поддержка НОВОЙ и СТАРОЙ структуры TGStat
    let items = document.querySelectorAll('.lm-list-container .col-12.col-sm-6.col-md-4');
    if (items.length === 0) {
      items = document.querySelectorAll('.peer-item-box');
    }
    
    items.forEach((item) => {
      let link = item.querySelector('a.text-body');
      if (!link) link = item.querySelector('a[href*="/channel/"]');
      if (!link) link = item.querySelector('a.peer-item-box');
      if (!link) link = item.querySelector('a');
      
      if (!link) return;
      
      const href = link.getAttribute('href') || '';
      let username = '';
      
      const usernameMatch = href.match(/\/channel\/@([^/?]+)/);
      if (usernameMatch) {
        username = usernameMatch[1];
      } else {
        const idMatch = href.match(/\/channel\/([^/?@]+)/);
        if (idMatch) {
          username = idMatch[1];
        } else {
          const directMatch = href.match(/t\.me\/([^/?]+)/);
          if (directMatch) username = directMatch[1];
        }
      }
      
      if (!username || seen.has(username)) return;
      seen.add(username);
      
      // Извлекаем название - поддержка новой и старой структуры
      let title = item.querySelector('.peer-item-box .font-16')?.textContent?.trim() || '';
      if (!title) title = link.querySelector('.font-16.text-dark')?.textContent?.trim() || '';
      if (!title) title = link.querySelector('.font-16')?.textContent?.trim() || '';
      if (!title) title = link.querySelector('h3')?.textContent?.trim() || '';
      if (!title) title = link.querySelector('.text-dark')?.textContent?.trim() || '';
      if (!title) title = item.querySelector('.font-16')?.textContent?.trim() || '';
      
      // Извлекаем описание
      let description = item.querySelector('.peer-item-box .font-14')?.textContent?.trim() || '';
      if (!description) description = link.querySelector('.font-14.text-muted')?.textContent?.trim() || '';
      if (!description) description = link.querySelector('.text-muted')?.textContent?.trim() || '';
      
      // Извлекаем подписчиков
      let subscribersText = item.querySelector('.peer-item-box .font-12')?.textContent?.trim() || '';
      if (!subscribersText) subscribersText = link.querySelector('.font-12.text-truncate')?.textContent?.trim() || '';
      if (!subscribersText) subscribersText = item.querySelector('.subscribers')?.textContent?.trim() || '';
      if (!subscribersText) subscribersText = item.querySelector('.font-12')?.textContent?.trim() || '';
      
      channels.push({
        username,
        title: title || username,
        description,
        subscribers: subscribersText,
        link: href
      });
    });
    
    return channels;
  });

  const parsedChannels: ParsedChannel[] = [];
  
  for (const item of channelsData) {
    const username = item.username || '';
    const subscribers = parseMetricStatic(item.subscribers);
    
    if (username) {
      parsedChannels.push({
        username,
        title: item.title || username,
        category_id: config.categoryId,
        subscribers,
        avg_post_reach: 0,
        engagement_rate: 0,
        language: 'ru',
        link: `https://t.me/${username}`,
        description: item.description || `Телеграм-канал @${username} в категории ${config.categoryName}`
      });
    }
  }
  
  return parsedChannels;
}

// Статическая версия parseMetric для использования до определения основной
function parseMetricStatic(value: any): number {
  if (typeof value === 'number') return value;
  const str = String(value || '0').replace(/\s/g, '');
  
  if (str.includes('M')) return Math.round(parseFloat(str.replace('M', '')) * 1000000);
  if (str.includes('K')) return Math.round(parseFloat(str.replace('K', '')) * 1000);
  
  return parseInt(str) || 0;
}

async function parseWithPuppeteer(categoryName: string, limit: number = 10, proxy?: string, onBatchReady?: (channels: ParsedChannel[]) => Promise<number>): Promise<ParsedChannel[]> {
  const config = categoryMapping[categoryName];
  if (!config) {
    console.error(`❌ Категория ${categoryName} не найдена`);
    return [];
  }

  console.log(`\n🌐 Запускаем браузер для парсинга: ${categoryName}`);
  
  const launchOptions: any = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  };

  if (proxy) {
    launchOptions.args.push(`--proxy-server=${proxy}`);
    console.log(`🔐 Используем прокси: ${proxy}`);
  }

  const browser = await puppeteer.launch(launchOptions);
  const page = await browser.newPage();

  try {
    // Используем случайный User-Agent для имитации разных устройств
    const userAgent = getRandomUserAgent();
    await page.setUserAgent(userAgent);
    console.log(`🎭 User-Agent: ${userAgent.substring(0, 50)}...`);
    
    // Устанавливаем дополнительные headers для имитации реального браузера
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Cache-Control': 'max-age=0'
    });
    
    // Загружаем cookies из файла или пытаемся автологин
    console.log('🔐 Проверка авторизации TGStat...');
    
    const cookies = await loadCookies();
    
    if (cookies && cookies.length > 0) {
      try {
        await page.setCookie(...cookies);
        console.log(`🔑 Установлено ${cookies.length} cookies из файла`);
      } catch (cookieErr: any) {
        console.log(`⚠️ Ошибка установки cookies: ${cookieErr.message}`);
      }
    } else if (process.env.TGSTAT_COOKIES) {
      // Fallback на cookies из переменной окружения
      try {
        const cookieString = process.env.TGSTAT_COOKIES;
        const envCookies = cookieString.split(';').map(cookie => {
          const [name, ...valueParts] = cookie.trim().split('=');
          const value = valueParts.join('=');
          return {
            name: name.trim(),
            value: value.trim(),
            domain: '.tgstat.ru',
            path: '/',
            secure: true,
            sameSite: 'Lax' as const
          };
        }).filter(c => c.name && c.value);
        
        await page.setCookie(...envCookies);
        console.log(`🔑 Установлено ${envCookies.length} cookies из ENV`);
      } catch (cookieErr: any) {
        console.log(`⚠️ Ошибка установки cookies: ${cookieErr.message}`);
      }
    } else {
      console.log('⚠️ ВНИМАНИЕ: Cookies не найдены!');
      console.log('   Запустите: npx tsx scripts/tgstat-auth.ts');
      console.log('   Или установите TGSTAT_EMAIL и TGSTAT_PASSWORD в .env');
    }
    
    console.log(`📡 Загружаем страницу каталога: ${config.tgstatUrl}`);
    await page.goto(config.tgstatUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // ПРОВЕРКА КАПЧИ: Пробуем автоматически кликнуть
    let captchaWaitTime = 0;
    const maxCaptchaWait = 60000; // 1 минута максимум
    let captchaClicked = false;
    
    while (captchaWaitTime < maxCaptchaWait) {
      const hasCaptcha = await page.evaluate(() => {
        const bodyText = document.body.innerText.toLowerCase();
        // Проверяем только явные признаки капчи
        const hasCaptchaText = bodyText.includes('подозрение на робота') || 
               bodyText.includes('я не робот') ||
               bodyText.includes('captcha') ||
               bodyText.includes('recaptcha');
        const hasCaptchaElement = !!document.querySelector('iframe[src*="captcha"]') ||
               !!document.querySelector('iframe[src*="recaptcha"]') ||
               !!document.querySelector('.g-recaptcha') ||
               !!document.querySelector('#captcha');
        return hasCaptchaText || hasCaptchaElement;
      });
      
      if (!hasCaptcha) break;
      
      if (!captchaClicked) {
        console.log('\n🤖 ОБНАРУЖЕНА КАПЧА! Пробуем автоматически кликнуть...');
        
        try {
          // Ждём появления модалки с капчей
          await page.waitForSelector('.modal-dialog, #recaptcha-widget, iframe', { timeout: 3000 });
          await randomDelay(1000, 2000);
          
          // Получаем все фреймы и ищем recaptcha anchor frame
          const frames = page.frames();
          for (const frame of frames) {
            const url = frame.url();
            if (url.includes('recaptcha') && url.includes('anchor')) {
              console.log('   📍 Найден iframe рекапчи');
              
              // Ждём загрузки чекбокса внутри iframe
              try {
                await frame.waitForSelector('.recaptcha-checkbox-border, #recaptcha-anchor', { timeout: 3000 });
                
                // Имитируем человеческое поведение перед кликом
                await randomDelay(500, 1500);
                
                const checkbox = await frame.$('.recaptcha-checkbox-border');
                if (checkbox) {
                  // Получаем координаты и кликаем с небольшим смещением
                  const box = await checkbox.boundingBox();
                  if (box) {
                    const x = box.x + box.width / 2 + (Math.random() * 10 - 5);
                    const y = box.y + box.height / 2 + (Math.random() * 10 - 5);
                    await page.mouse.move(x, y, { steps: 10 });
                    await randomDelay(100, 300);
                    await page.mouse.click(x, y);
                    console.log('   ✅ Клик по чекбоксу рекапчи');
                    captchaClicked = true;
                    break;
                  }
                }
                
                // Альтернативный способ - прямой клик
                if (!captchaClicked) {
                  await frame.click('.recaptcha-checkbox-border, #recaptcha-anchor, [role="checkbox"]');
                  console.log('   ✅ Прямой клик по чекбоксу');
                  captchaClicked = true;
                  break;
                }
              } catch (frameErr) {
                console.log(`   ⚠️ Ошибка в iframe: ${frameErr}`);
              }
            }
          }
          
          if (!captchaClicked) {
            console.log('   ⚠️ Iframe рекапчи не найден, ждём ручного решения...');
          }
        } catch (clickErr: any) {
          console.log(`   ⚠️ Ошибка поиска капчи: ${clickErr.message}`);
        }
        
        await randomDelay(3000, 5000);
      }
      
      await new Promise(r => setTimeout(r, 3000));
      captchaWaitTime += 3000;
      
      if (captchaWaitTime % 15000 === 0) {
        console.log(`   ⏳ Ожидание решения капчи... ${captchaWaitTime / 1000} сек`);
      }
    }
    
    if (captchaWaitTime > 0 && captchaWaitTime < maxCaptchaWait) {
      console.log('✅ Капча пройдена! Продолжаем парсинг...');
      await randomDelay(2000, 3000);
    } else if (captchaWaitTime >= maxCaptchaWait) {
      console.log('❌ Не удалось пройти капчу автоматически.');
      console.log('   Перезапустите скрипт или решите вручную.');
      await browser.close();
      return [];
    }

    // Имитируем поведение пользователя
    await randomDelay(2000, 4000);
    await simulateHumanBehavior(page);

    // ПРОВЕРКА АВТОРИЗАЦИИ: Ищем признаки того, что требуется логин
    const authCheckText = await page.evaluate(() => document.body.innerText.substring(0, 1000));
    if (authCheckText.includes('Войти') || authCheckText.includes('авторизация') || authCheckText.includes('Sign in') || authCheckText.includes('Регистрация')) {
      console.log('\n❌ АВТОРИЗАЦИЯ НЕ АКТИВНА!');
      console.log('   Cookies устарели или не установлены.');
      console.log('\n📋 Для исправления:');
      console.log('   1. Установите в .env:');
      console.log('      TGSTAT_EMAIL=your@email.com');
      console.log('      TGSTAT_PASSWORD=your_password');
      console.log('   2. Запустите: npx tsx scripts/tgstat-auth.ts');
      console.log('   3. Перезапустите парсинг\n');
      
      await browser.close();
      return []; // Возвращаем пустой массив вместо 0 каналов
    }

    // Ждём загрузки списка каналов
    try {
      await page.waitForSelector('a[href*="/channel/"], .peer-item-box', { timeout: 15000 });
    } catch (e) {
      // Повторная проверка на блокировку авторизации
      const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 300));
      if (bodyText.includes('авторизация') || bodyText.includes('Войти')) {
        console.log('\n❌ TGStat требует авторизацию!');
        console.log('   Запустите: npx tsx scripts/tgstat-auth.ts\n');
        await browser.close();
        return [];
      }
      throw new Error('Каналы не найдены на странице');
    }
    
    // Дополнительная проверка: если каналов 0, возможно сессия истекла
    const initialChannelCount = await page.evaluate(() => {
      const newItems = document.querySelectorAll('.lm-list-container .col-12.col-sm-6.col-md-4');
      const oldItems = document.querySelectorAll('.peer-item-box');
      return Math.max(newItems.length, oldItems.length);
    });
    
    if (initialChannelCount === 0) {
      console.log('\n⚠️ Страница загружена, но каналов не найдено (0).');
      console.log('   Возможно, сессия истекла. Попробуйте перелогиниться.');
      console.log('   Запустите: npx tsx scripts/tgstat-auth.ts\n');
      await browser.close();
      return [];
    }
    
    console.log(`✅ Авторизация OK! Найдено ${initialChannelCount} каналов на странице`)
    
    // Кликаем на кнопку "Показать больше" для загрузки всех каналов
    let previousCount = 0;
    let currentCount = 0;
    let attempts = 0;
    let noChangeAttempts = 0;
    const maxAttempts = 100; // Максимум 100 кликов
    const maxNoChange = 5; // Если 5 раз подряд не растет - останавливаемся
    
    console.log('📜 Загружаем все каналы через скролл и кнопку...');
    
    while (attempts < maxAttempts && noChangeAttempts < maxNoChange) {
      previousCount = currentCount;
      
      // Сначала скролл для триггера ленивой загрузки
      await page.evaluate(() => {
        window.scrollBy(0, 1000);
      });
      await randomDelay(500, 1000);
      
      // Скролл вниз до конца
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await randomDelay(1000, 2000);
      
      // Пробуем найти и кликнуть кнопку
      let buttonClicked = false;
      
      // Ищем кнопку
      const buttonHandle = await page.$('button.lm-button');
      
      if (buttonHandle) {
        console.log(`   🖱️ Клик #${attempts + 1}...`);
        
        // Скроллим к кнопке
        await buttonHandle.scrollIntoView();
        await randomDelay(500, 1000);
        
        // Слушаем ВСЕ сетевые ответы
        const responsePromise = page.waitForResponse(
          res => res.url().includes('/items'),
          { timeout: 15000 }
        ).catch(() => null);
        
        // Кликаем
        await buttonHandle.click();
        buttonClicked = true;
        
        // Ждём ответ
        const response = await responsePromise;
        
        if (response) {
          const status = response.status();
          const url = response.url();
          console.log(`      📥 Ответ: ${status} от ${url.substring(0, 50)}...`);
          
          if (status === 200) {
            const text = await response.text().catch(() => '');
            console.log(`      📦 Данные: ${text.length} байт`);
            
            // Ждём пока DOM обновится
            await randomDelay(2000, 3000);
          } else if (status === 403) {
            console.log(`      ❌ Cloudflare заблокировал запрос`);
          }
        } else {
          console.log(`      ⚠️ Нет ответа от сервера`);
        }
      } else {
        console.log(`   ⚠️ Кнопка не найдена`);
      }
      
      // Дополнительное ожидание
      await randomDelay(2000, 4000);
      
      // Подсчитываем текущее количество каналов (поддержка новой и старой структуры)
      currentCount = await page.evaluate(() => {
        const newItems = document.querySelectorAll('.lm-list-container .col-12.col-sm-6.col-md-4');
        const oldItems = document.querySelectorAll('.peer-item-box');
        return Math.max(newItems.length, oldItems.length);
      });
      
      if (currentCount > previousCount) {
        console.log(`   Загружено: ${currentCount} каналов (+${currentCount - previousCount})`);
        noChangeAttempts = 0;
      } else {
        noChangeAttempts++;
        if (!buttonClicked && noChangeAttempts === 1) {
          console.log('   ⚠️ Кнопка не найдена, пробуем только скролл...');
        } else {
          console.log(`   Без изменений (попытка ${noChangeAttempts}/${maxNoChange})`);
        }
      }
      
      attempts++;
      
      // СОХРАНЕНИЕ ПОРЦИЯМИ: каждые 10 кликов сохраняем в БД
      if (onBatchReady && attempts % 10 === 0 && currentCount > 0) {
        console.log(`\n💾 Промежуточное сохранение (клик #${attempts})...`);
        const batchChannels = await extractChannelsFromPage(page, config);
        if (batchChannels.length > 0) {
          const saved = await onBatchReady(batchChannels);
          console.log(`   ✅ Сохранено ${saved} каналов в БД\n`);
        }
      }
      
      // Проверяем есть ли ещё кнопка
      const hasMoreButton = await page.evaluate(() => {
        const btn = document.querySelector('button.lm-button');
        return btn !== null && (btn as HTMLElement).offsetParent !== null;
      });
      
      if (!hasMoreButton && noChangeAttempts >= 2) {
        console.log(`   ✅ Кнопка исчезла, загрузка завершена`);
        break;
      }
    }
    
    console.log(`✅ Загрузка завершена: ${currentCount} каналов за ${attempts} кликов`);
    
    // Финальное сохранение
    if (onBatchReady && currentCount > 0) {
      console.log(`\n💾 Финальное сохранение...`);
      const finalChannels = await extractChannelsFromPage(page, config);
      if (finalChannels.length > 0) {
        const saved = await onBatchReady(finalChannels);
        console.log(`   ✅ Финально сохранено ${saved} каналов в БД`);
      }
    }
    
    // Извлекаем данные каналов из карточек (УЛУЧШЕННАЯ ВЕРСИЯ с резервными селекторами)
    // Поддержка новой структуры TGStat (2024+) и старой
    const channelsData = await page.evaluate(() => {
      const channels: any[] = [];
      const seen = new Set<string>();
      const skipped: string[] = [];
      
      // Ищем все карточки каналов - поддержка НОВОЙ и СТАРОЙ структуры
      let items = document.querySelectorAll('.lm-list-container .col-12.col-sm-6.col-md-4');
      if (items.length === 0) {
        items = document.querySelectorAll('.peer-item-box');
      }
      
      console.log(`[Parser] Найдено ${items.length} карточек каналов`);
      
      items.forEach((item, index) => {
        // Пробуем разные варианты селекторов для ссылки
        let link = item.querySelector('a.text-body');
        if (!link) link = item.querySelector('a[href*="/channel/"]');
        if (!link) link = item.querySelector('a.peer-item-box');
        if (!link) link = item.querySelector('a');
        
        if (!link) {
          skipped.push(`Карточка ${index}: нет ссылки`);
          return;
        }
        
        const href = link.getAttribute('href') || '';
        
        // Извлекаем username/ID из href
        // TGStat использует 2 формата:
        // 1. /channel/@username - публичные каналы
        // 2. /channel/ID - приватные каналы без @username
        let username = '';
        
        // Вариант 1: @username
        const usernameMatch = href.match(/\/channel\/@([^/?]+)/);
        if (usernameMatch) {
          username = usernameMatch[1];
        } else {
          // Вариант 2: ID без @
          const idMatch = href.match(/\/channel\/([^/?@]+)/);
          if (idMatch) {
            username = idMatch[1]; // Используем ID как username
          } else {
            // Вариант 3: прямая ссылка t.me
            const directMatch = href.match(/t\.me\/([^/?]+)/);
            if (directMatch) username = directMatch[1];
          }
        }
        
        if (!username || seen.has(username)) {
          if (!username) skipped.push(`Карточка ${index}: нет username (href: ${href})`);
          return;
        }
        seen.add(username);
        
        // Извлекаем название (пробуем разные селекторы - новая и старая структура)
        let title = item.querySelector('.peer-item-box .font-16')?.textContent?.trim() || '';
        if (!title) title = link.querySelector('.font-16.text-dark')?.textContent?.trim() || '';
        if (!title) title = link.querySelector('.font-16')?.textContent?.trim() || '';
        if (!title) title = link.querySelector('h3')?.textContent?.trim() || '';
        if (!title) title = link.querySelector('.text-dark')?.textContent?.trim() || '';
        if (!title) title = item.querySelector('.font-16')?.textContent?.trim() || '';
        
        // Извлекаем описание
        let description = item.querySelector('.peer-item-box .font-14')?.textContent?.trim() || '';
        if (!description) description = link.querySelector('.font-14.text-muted')?.textContent?.trim() || '';
        if (!description) description = link.querySelector('.text-muted')?.textContent?.trim() || '';
        if (!description) description = item.querySelector('.description')?.textContent?.trim() || '';
        
        // Извлекаем подписчиков
        let subscribersText = item.querySelector('.peer-item-box .font-12')?.textContent?.trim() || '';
        if (!subscribersText) subscribersText = link.querySelector('.font-12.text-truncate')?.textContent?.trim() || '';
        if (!subscribersText) subscribersText = item.querySelector('.subscribers')?.textContent?.trim() || '';
        if (!subscribersText) subscribersText = item.querySelector('.font-12')?.textContent?.trim() || '';
        
        if (!title) {
          skipped.push(`Карточка ${index} (@${username}): нет title`);
        }
        
        channels.push({
          username,
          title: title || username, // Если нет title, используем username
          description,
          subscribers: subscribersText,
          link: href
        });
      });
      
      return { channels, skipped };
    });

    const { channels, skipped } = channelsData;
    
    console.log(`📊 Извлечено записей: ${channels.length}`);
    if (skipped.length > 0) {
      console.log(`⚠️ Пропущено карточек: ${skipped.length}`);
      // Показываем первые 5 причин пропуска для анализа
      if (skipped.length <= 5) {
        skipped.forEach(msg => console.log(`   - ${msg}`));
      } else {
        console.log(`   - ${skipped[0]}`);
        console.log(`   - ${skipped[1]}`);
        console.log(`   - ${skipped[2]}`);
        console.log(`   ... и ещё ${skipped.length - 3}`);
      }
    }
    
    // Скриншот и HTML не нужны для продакшн-сбора (только для отладки)

    const parsedChannels: ParsedChannel[] = [];
    const parseErrors: string[] = [];
    
    // Обрабатываем ВСЕ извлечённые каналы
    const channelsToProcess = channels;
    
    for (const item of channelsToProcess) {
      const username = item.username || '';
      const title = item.title || '';
      const subscribers = parseMetric(item.subscribers);
      const avg_post_reach = parseMetric(item.avg_post_reach || item.reach);
      const engagement_rate = parseFloat(String(item.err || item.er || item.engagement_rate).replace('%', '').replace(',', '.')) || 0;

      // Более мягкая валидация - требуем только username
      if (username) {
        parsedChannels.push({
          username,
          title: title || username, // Если нет title, используем username
          category_id: config.categoryId,
          subscribers,
          avg_post_reach,
          engagement_rate,
          language: 'ru',
          link: `https://t.me/${username}`,
          description: item.description || `Телеграм-канал @${username} в категории ${config.categoryName}`
        });
      } else {
        parseErrors.push(`Нет username`);
      }
    }
    
    if (parseErrors.length > 0) {
      console.log(`⚠️ Ошибки парсинга: ${parseErrors.length} каналов без username`);
    }

    console.log(`✅ Успешно спарсено: ${parsedChannels.length} каналов`);
    return parsedChannels;

  } catch (error: any) {
    console.error(`❌ Ошибка парсинга:`, error.message);
    return [];
  } finally {
    await browser.close();
  }
}

function parseMetric(value: any): number {
  if (typeof value === 'number') return value;
  const str = String(value || '0').replace(/\s/g, '');
  
  if (str.includes('M')) return Math.round(parseFloat(str.replace('M', '')) * 1000000);
  if (str.includes('K')) return Math.round(parseFloat(str.replace('K', '')) * 1000);
  
  return parseInt(str) || 0;
}

// Флаг для единоразового детального логирования
let detailedErrorLogged = false;

async function saveToDirectus(channel: ParsedChannel): Promise<boolean> {
  try {
    // Гарантируем что link всегда присутствует
    const channelData = {
      username: channel.username,
      title: channel.title,
      category_id: channel.category_id,
      subscribers: channel.subscribers,
      avg_post_reach: channel.avg_post_reach || 0,
      engagement_rate: channel.engagement_rate || 0,
      language: channel.language || 'ru',
      description: channel.description || '',
      link: channel.link || `https://t.me/${channel.username}`
    };

    // Сначала проверяем существует ли канал
    const checkResponse = await axios.get(`${DIRECTUS_URL}/items/telegram_channels`, {
      headers: { 'Authorization': `Bearer ${DIRECTUS_TOKEN}` },
      params: { 'filter[username][_eq]': channel.username, 'limit': 1 }
    });
    
    if (checkResponse.data?.data?.length > 0) {
      // Обновляем существующий
      const existingId = checkResponse.data.data[0].id;
      await axios.patch(`${DIRECTUS_URL}/items/telegram_channels/${existingId}`, channelData, {
        headers: { 'Authorization': `Bearer ${DIRECTUS_TOKEN}` }
      });
      return true; // Обновлён
    }
    
    // Создаём новый
    await axios.post(`${DIRECTUS_URL}/items/telegram_channels`, channelData, {
      headers: {
        'Authorization': `Bearer ${DIRECTUS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    return true;
  } catch (error: any) {
    // Детальное логирование первой ошибки
    if (!detailedErrorLogged) {
      detailedErrorLogged = true;
      console.error('\n🔍 ДЕТАЛЬНАЯ ДИАГНОСТИКА:');
      console.error(`   URL: ${DIRECTUS_URL}/items/telegram_channels`);
      console.error(`   Token: ${DIRECTUS_TOKEN?.substring(0, 10)}...`);
      console.error(`   Response status: ${error.response?.status}`);
      console.error(`   Response data:`, JSON.stringify(error.response?.data, null, 2));
      console.error(`   Error message: ${error.message}\n`);
    }
    // Молча пропускаем ошибки дубликатов
    if (error.response?.status !== 400) {
      console.error(`❌ @${channel.username}:`, error.response?.data?.errors?.[0]?.message || error.message);
    }
    return false;
  }
}

async function saveBatchToDirectus(channels: ParsedChannel[]): Promise<number> {
  let saved = 0;
  const batchSize = 50; // Сохраняем по 50 каналов за раз
  
  for (let i = 0; i < channels.length; i += batchSize) {
    const batch = channels.slice(i, i + batchSize);
    const promises = batch.map(channel => saveToDirectus(channel));
    const results = await Promise.all(promises);
    const batchSaved = results.filter(r => r).length;
    saved += batchSaved;
    
    console.log(`   Пакет ${Math.floor(i / batchSize) + 1}: сохранено ${batchSaved}/${batch.length} каналов`);
    
    // Небольшая задержка между пакетами
    if (i + batchSize < channels.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return saved;
}

async function parseAndSaveCategory(categoryName: string, perPage: number = 50, totalPages: number = 1, proxy?: string): Promise<number> {
  const config = categoryMapping[categoryName];
  if (!config) {
    console.error(`❌ Категория ${categoryName} не найдена`);
    return 0;
  }

  let totalSaved = 0;
  const savedUsernames = new Set<string>(); // Отслеживаем уже сохранённые

  // Callback для сохранения порциями ВО ВРЕМЯ парсинга
  const onBatchReady = async (channels: ParsedChannel[]): Promise<number> => {
    // Фильтруем уже сохранённые
    const newChannels = channels.filter(ch => !savedUsernames.has(ch.username));
    if (newChannels.length === 0) return 0;
    
    const saved = await saveBatchToDirectus(newChannels);
    newChannels.forEach(ch => savedUsernames.add(ch.username));
    totalSaved += saved;
    return saved;
  };

  for (let page = 1; page <= totalPages; page++) {
    console.log(`\n📄 Страница ${page}/${totalPages}`);
    
    // Парсим страницу с callback для промежуточного сохранения
    const channels = await parseWithPuppeteer(categoryName, perPage, proxy, onBatchReady);
    
    if (channels.length === 0) {
      console.log('❌ Каналы не найдены');
      break;
    }

    // Финальное сохранение для каналов, которые ещё не были сохранены
    const remainingChannels = channels.filter(ch => !savedUsernames.has(ch.username));
    if (remainingChannels.length > 0) {
      console.log(`💾 Досохраняем ${remainingChannels.length} оставшихся каналов...`);
      const saved = await saveBatchToDirectus(remainingChannels);
      remainingChannels.forEach(ch => savedUsernames.add(ch.username));
      totalSaved += saved;
    }
    
    console.log(`✅ Итого сохранено: ${totalSaved} каналов`);

    // Задержка между страницами (1 минута)
    if (page < totalPages) {
      console.log(`\n⏳ Ожидание 60 секунд перед следующей страницей (имитация пользователя)...`);
      await new Promise(r => setTimeout(r, 60000));
    }
  }

  return totalSaved;
}

async function main() {
  const category = process.argv[2]?.trim();
  const perPage = parseInt(process.argv[3]) || 100; // 100 каналов на страницу
  const totalPages = parseInt(process.argv[4]) || 1;
  const proxy = process.argv[5]; // Опционально: http://user:pass@host:port

  if (!category) {
    console.log('📋 Использование: npx tsx scripts/parse-tgstat-puppeteer.ts <категория> [каналов_на_страницу] [страниц] [прокси]');
    console.log('\nДоступные категории:');
    console.log('  - all (все категории)');
    console.log('  - empty (только пустые категории - 0 каналов)');
    Object.keys(categoryMapping).forEach(cat => console.log(`  - ${cat}`));
    console.log('\nПример: npx tsx scripts/parse-tgstat-puppeteer.ts sport 100 2');
    console.log('Все категории: npx tsx scripts/parse-tgstat-puppeteer.ts all');
    console.log('Только пустые: npx tsx scripts/parse-tgstat-puppeteer.ts empty');
    return;
  }

  // Парсим только пустые категории (0 каналов в Directus)
  if (category.toLowerCase() === 'empty') {
    console.log('🔍 Проверяем категории без каналов...');
    
    const emptyCategories: string[] = [];
    for (const [catName, config] of Object.entries(categoryMapping)) {
      try {
        // Используем агрегацию для точного подсчёта
        const response = await axios.get(`${DIRECTUS_URL}/items/telegram_channels`, {
          headers: { 'Authorization': `Bearer ${DIRECTUS_TOKEN}` },
          params: { 
            'filter': JSON.stringify({ category_id: { _eq: config.categoryId } }),
            'aggregate[count]': 'id'
          }
        });
        const countRaw = response.data.data?.[0]?.count?.id;
        const count = parseInt(countRaw) || 0;
        if (count < 1000) {
          emptyCategories.push(catName);
          console.log(`  📭 ${catName}: ${count} каналов (< 1000)`);
        } else {
          console.log(`  ✅ ${catName}: ${count} каналов`);
        }
      } catch (e) {
        console.log(`  ⚠️ ${catName}: ошибка проверки`);
      }
    }
    
    if (emptyCategories.length === 0) {
      console.log('\n🎉 Все категории уже заполнены!');
      return;
    }
    
    // Перемешиваем категории случайно чтобы разные процессы не парсили одно и то же
    for (let i = emptyCategories.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [emptyCategories[i], emptyCategories[j]] = [emptyCategories[j], emptyCategories[i]];
    }
    
    console.log(`\n📊 Найдено пустых категорий: ${emptyCategories.length}`);
    console.log(`🎲 Случайный порядок: ${emptyCategories.join(', ')}`);
    console.log(`\n🚀 Начинаем парсинг пустых категорий...`);
    
    let grandTotal = 0;
    for (let i = 0; i < emptyCategories.length; i++) {
      // Перед каждой категорией перепроверяем - может другой процесс уже заполнил
      const cat = emptyCategories[i];
      try {
        const checkResp = await axios.get(`${DIRECTUS_URL}/items/telegram_channels`, {
          headers: { 'Authorization': `Bearer ${DIRECTUS_TOKEN}` },
          params: { 
            'filter': JSON.stringify({ category_id: { _eq: categoryMapping[cat].categoryId } }),
            'aggregate[count]': 'id'
          }
        });
        const currentCount = parseInt(checkResp.data.data?.[0]?.count?.id) || 0;
        if (currentCount >= 1000) {
          console.log(`\n⏭️ Категория ${cat} уже заполнена (${currentCount} каналов), пропускаем...`);
          continue;
        }
      } catch (e) {}
      console.log(`\n${'='.repeat(50)}`);
      console.log(`[${i + 1}/${emptyCategories.length}] 📁 Категория: ${cat}`);
      console.log('='.repeat(50));
      
      try {
        const saved = await parseAndSaveCategory(cat, perPage, totalPages, proxy);
        grandTotal += saved;
        console.log(`✅ Категория ${cat}: сохранено ${saved} каналов`);
      } catch (error) {
        console.error(`❌ Ошибка при парсинге ${cat}: ${error}`);
      }
      
      if (i < emptyCategories.length - 1) {
        console.log(`\n⏳ Пауза 30 сек перед следующей категорией...`);
        await new Promise(r => setTimeout(r, 30000));
      }
    }
    
    console.log(`\n${'='.repeat(50)}`);
    console.log(`🎉 ИТОГО: ${grandTotal} каналов за эту сессию`);
    console.log('='.repeat(50));
    return;
  }

  // Парсим все категории
  if (category.toLowerCase() === 'all') {
    const progress = loadProgress();
    const allCategories = Object.keys(categoryMapping);
    const remainingCategories = allCategories.filter(cat => !progress.completedCategories.includes(cat));
    
    console.log(`🚀 Парсинг категорий TGStat`);
    console.log(`📊 Всего категорий: ${allCategories.length}`);
    console.log(`✅ Уже собрано: ${progress.completedCategories.length} (${progress.completedCategories.join(', ') || 'нет'})`);
    console.log(`⏳ Осталось: ${remainingCategories.length}`);
    console.log(`📊 Настройки: ${perPage} каналов/страницу, ${totalPages} страниц`);
    if (proxy) console.log(`🔐 Прокси: ${proxy}`);
    
    if (remainingCategories.length === 0) {
      console.log(`\n🎉 Все категории уже собраны! Для пересбора удалите файл tgstat-progress.json`);
      return;
    }
    
    let grandTotal = 0;
    
    for (let i = 0; i < remainingCategories.length; i++) {
      const cat = remainingCategories[i];
      console.log(`\n${'='.repeat(50)}`);
      console.log(`[${i + 1}/${remainingCategories.length}] 📁 Категория: ${cat}`);
      console.log('='.repeat(50));
      
      try {
        const saved = await parseAndSaveCategory(cat, perPage, totalPages, proxy);
        grandTotal += saved;
        
        // Помечаем категорию как завершённую
        markCategoryCompleted(cat);
        console.log(`✅ Категория ${cat}: сохранено ${saved} каналов`);
      } catch (error) {
        console.error(`❌ Ошибка при парсинге ${cat}: ${error}`);
        console.log(`⚠️ Категория ${cat} НЕ помечена как завершённая, будет повторена при следующем запуске`);
      }
      
      // Пауза между категориями (30 сек)
      if (i < remainingCategories.length - 1) {
        console.log(`\n⏳ Пауза 30 сек перед следующей категорией...`);
        await new Promise(r => setTimeout(r, 30000));
      }
    }
    
    const finalProgress = loadProgress();
    console.log(`\n${'='.repeat(50)}`);
    console.log(`🎉 ИТОГО: ${grandTotal} каналов за эту сессию`);
    console.log(`📊 Завершено категорий: ${finalProgress.completedCategories.length}/${allCategories.length}`);
    console.log('='.repeat(50));
    return;
  }

  console.log(`🚀 Парсинг категории: ${category}`);
  console.log(`📊 Настройки: ${perPage} каналов/страницу, ${totalPages} страниц`);
  if (proxy) console.log(`🔐 Прокси: ${proxy}`);
  
  const totalSaved = await parseAndSaveCategory(category, perPage, totalPages, proxy);
  
  console.log(`\n✅ Всего сохранено: ${totalSaved} каналов`);
}

main();
