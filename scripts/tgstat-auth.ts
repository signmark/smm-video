import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config();
puppeteer.use(StealthPlugin());

const COOKIES_FILE = path.join(process.cwd(), 'tgstat-cookies.json');

interface TGStatCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export async function loadCookies(): Promise<TGStatCookie[] | null> {
  try {
    if (fs.existsSync(COOKIES_FILE)) {
      const data = fs.readFileSync(COOKIES_FILE, 'utf-8');
      const cookies = JSON.parse(data);
      console.log(`🍪 Загружено ${cookies.length} cookies из файла`);
      return cookies;
    }
  } catch (error) {
    console.log('⚠️ Не удалось загрузить cookies из файла');
  }
  return null;
}

export async function saveCookies(cookies: TGStatCookie[]): Promise<void> {
  try {
    fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
    console.log(`💾 Сохранено ${cookies.length} cookies в файл`);
  } catch (error) {
    console.error('❌ Ошибка сохранения cookies:', error);
  }
}

export async function checkAuth(page: any): Promise<boolean> {
  try {
    await page.goto('https://tgstat.ru/tech', { waitUntil: 'networkidle2', timeout: 30000 });
    
    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
    
    if (bodyText.includes('Войти') || bodyText.includes('авторизация') || bodyText.includes('Sign in')) {
      console.log('❌ Авторизация НЕ активна - требуется логин');
      return false;
    }
    
    const hasChannels = await page.evaluate(() => {
      const channels = document.querySelectorAll('a[href*="/channel/"], .peer-item-box');
      return channels.length > 0;
    });
    
    if (hasChannels) {
      console.log('✅ Авторизация активна - каналы видны');
      return true;
    }
    
    console.log('⚠️ Страница загружена, но каналы не найдены');
    return false;
  } catch (error: any) {
    console.error('❌ Ошибка проверки авторизации:', error.message);
    return false;
  }
}

export async function loginToTGStat(): Promise<TGStatCookie[] | null> {
  const email = process.env.TGSTAT_EMAIL;
  const password = process.env.TGSTAT_PASSWORD;
  
  if (!email || !password) {
    console.error('❌ TGSTAT_EMAIL и TGSTAT_PASSWORD не настроены в .env');
    console.log('   Установите:');
    console.log('   TGSTAT_EMAIL=your@email.com');
    console.log('   TGSTAT_PASSWORD=your_password');
    return null;
  }
  
  console.log('🔐 Запуск автоматического логина на TGStat...');
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  
  const page = await browser.newPage();
  
  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    console.log('📡 Переход на страницу логина...');
    await page.goto('https://tgstat.ru/login', { waitUntil: 'networkidle2', timeout: 30000 });
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('📧 Ввод email...');
    const emailInput = await page.$('input[type="email"], input[name="email"], input[placeholder*="mail"], #email');
    if (emailInput) {
      await emailInput.type(email, { delay: 50 });
    } else {
      throw new Error('Поле email не найдено');
    }
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    console.log('🔑 Ввод пароля...');
    const passwordInput = await page.$('input[type="password"], input[name="password"], #password');
    if (passwordInput) {
      await passwordInput.type(password, { delay: 50 });
    } else {
      throw new Error('Поле пароля не найдено');
    }
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    console.log('🖱️ Клик на кнопку входа...');
    const submitButton = await page.$('button[type="submit"], input[type="submit"], button:has-text("Войти"), .btn-primary');
    if (submitButton) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
        submitButton.click()
      ]);
    } else {
      await page.keyboard.press('Enter');
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
    }
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const currentUrl = page.url();
    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
    
    if (bodyText.includes('Неверный') || bodyText.includes('ошибка') || bodyText.includes('Invalid')) {
      console.error('❌ Ошибка входа - неверные учетные данные');
      await browser.close();
      return null;
    }
    
    if (currentUrl.includes('login')) {
      console.log('⚠️ Всё ещё на странице логина, возможно требуется капча');
      await browser.close();
      return null;
    }
    
    console.log('✅ Вход выполнен успешно!');
    
    const cookies = await page.cookies();
    console.log(`🍪 Получено ${cookies.length} cookies`);
    
    const tgstatCookies = cookies.filter(c => c.domain.includes('tgstat'));
    await saveCookies(tgstatCookies);
    
    await browser.close();
    return tgstatCookies;
    
  } catch (error: any) {
    console.error('❌ Ошибка логина:', error.message);
    await browser.close();
    return null;
  }
}

export async function ensureAuthenticated(): Promise<TGStatCookie[] | null> {
  console.log('\n🔍 Проверка авторизации TGStat...\n');
  
  let cookies = await loadCookies();
  
  if (!cookies && process.env.TGSTAT_COOKIES) {
    console.log('📋 Используем cookies из переменной окружения...');
    const cookieString = process.env.TGSTAT_COOKIES;
    cookies = cookieString.split(';').map(cookie => {
      const [name, ...valueParts] = cookie.trim().split('=');
      return {
        name: name.trim(),
        value: valueParts.join('=').trim(),
        domain: '.tgstat.ru',
        path: '/'
      };
    }).filter(c => c.name && c.value);
  }
  
  if (cookies && cookies.length > 0) {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    
    try {
      await page.setCookie(...cookies);
      const isLoggedIn = await checkAuth(page);
      await browser.close();
      
      if (isLoggedIn) {
        return cookies;
      }
      
      console.log('⚠️ Cookies устарели, пробуем перелогиниться...');
    } catch (e) {
      await browser.close();
    }
  }
  
  return await loginToTGStat();
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  ensureAuthenticated().then(cookies => {
    if (cookies) {
      console.log('\n✅ Авторизация успешна! Готов к парсингу.');
    } else {
      console.log('\n❌ Не удалось авторизоваться.');
      process.exit(1);
    }
  });
}
