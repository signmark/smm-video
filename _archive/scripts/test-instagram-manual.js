/**
 * Ручная публикация в Instagram через Puppeteer браузер
 */
import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function postToInstagram() {
  console.log('🚀 Запускаем автоматическую публикацию в Instagram...');
  
  const browser = await puppeteer.launch({
    headless: true, // Без показа браузера
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor'
    ],
    executablePath: '/nix/store/58gnnsq47bm8zw871chaxm65zrnmnw53-ungoogled-chromium-108.0.5359.95/bin/chromium-browser'
  });

  try {
    const page = await browser.newPage();
    
    // Устанавливаем User-Agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    // Переходим на Instagram
    console.log('📱 Переходим на Instagram...');
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // Ждем загрузки и ищем поле логина
    console.log('🔍 Ищем поля для входа...');
    await page.waitForSelector('input[name="username"]', { timeout: 15000 });
    
    console.log('🔑 Вводим логин и пароль...');
    
    // Очищаем поля и вводим данные
    await page.click('input[name="username"]');
    await page.keyboard.selectAll();
    await page.type('input[name="username"]', 'it.zhdanov', { delay: 100 });
    
    await page.click('input[name="password"]');
    await page.keyboard.selectAll();
    await page.type('input[name="password"]', process.env.INSTAGRAM_TEST_PASSWORD, { delay: 100 });
    
    // Нажимаем кнопку входа
    console.log('🚪 Нажимаем кнопку входа...');
    await page.click('button[type="submit"]');
    
    console.log('⏳ Ждем авторизации...');
    
    // Ждем либо главную страницу, либо страницу с дополнительными проверками
    try {
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (navError) {
      console.log('⚠️ Возможно потребуется дополнительная проверка...');
    }
    
    // Проверяем текущий URL
    const currentUrl = page.url();
    console.log('📍 Текущий URL:', currentUrl);
    
    if (currentUrl.includes('instagram.com') && !currentUrl.includes('login')) {
      console.log('✅ Авторизация успешна!');
      
      // Создаем простой тестовый пост через текстовую публикацию
      console.log('📝 Попробуем создать текстовый пост...');
      
      // Ищем кнопку создания
      const selectors = [
        'a[href="/create/select/"]',
        'svg[aria-label="Новая публикация"]',
        'svg[aria-label="New post"]',
        '[aria-label*="Create"]',
        '[aria-label*="Создать"]',
        'a[href*="create"]'
      ];
      
      let createButton = null;
      for (const selector of selectors) {
        try {
          createButton = await page.$(selector);
          if (createButton) {
            console.log(`✅ Найдена кнопка создания по селектору: ${selector}`);
            break;
          }
        } catch (e) {
          // Игнорируем ошибки поиска
        }
      }
      
      if (createButton) {
        await createButton.click();
        console.log('🎨 Кнопка создания поста нажата!');
        
        // Ждем небольшую паузу для загрузки
        await page.waitForTimeout(3000);
        
        console.log('📸 Страница создания поста загружена');
        console.log('🎯 На этом этапе потребуется ручная загрузка изображения');
        
      } else {
        console.log('❌ Кнопка создания поста не найдена');
      }
      
    } else {
      console.log('❌ Авторизация не удалась или требуется дополнительная проверка');
      console.log('🔗 URL:', currentUrl);
    }
    
    // Делаем скриншот для отладки
    await page.screenshot({ path: 'instagram-screenshot.png', fullPage: true });
    console.log('📷 Скриншот сохранен как instagram-screenshot.png');
    
    console.log('✅ Скрипт завершен. Проверьте результат.');
    
  } catch (error) {
    console.error('❌ Ошибка при работе с Instagram:', error.message);
    
    // Делаем скриншот ошибки
    try {
      const page = browser.pages()[0];
      if (page) {
        await page.screenshot({ path: 'instagram-error.png', fullPage: true });
        console.log('📷 Скриншот ошибки сохранен как instagram-error.png');
      }
    } catch (screenshotError) {
      console.log('❌ Не удалось сделать скриншот ошибки');
    }
  } finally {
    await browser.close();
    console.log('🏁 Браузер закрыт');
  }
}

postToInstagram();
