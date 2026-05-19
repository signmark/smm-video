import puppeteer from 'puppeteer';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Настройки Instagram
const INSTAGRAM_USERNAME = 'it.zhdanov';
const INSTAGRAM_PASSWORD = 'QtpZ3dh70307';

// Тестовые данные для поста
const testPost = {
  caption: '🚀 Тестовый пост из SMM Manager! Автоматическая публикация работает! #SMM #автоматизация #test',
  imageUrl: 'https://picsum.photos/1080/1080?random=1'
};

async function downloadImage(url, filepath) {
  console.log(`📥 Скачиваю изображение: ${url}`);
  
  const response = await axios({
    method: 'GET',
    url: url,
    responseType: 'stream'
  });
  
  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(filepath);
    response.data.pipe(writer);
    
    writer.on('finish', () => {
      console.log(`✅ Изображение сохранено: ${filepath}`);
      resolve(filepath);
    });
    
    writer.on('error', reject);
  });
}

async function publishToInstagram(postData) {
  console.log('🚀 Запускаю публикацию в Instagram...');
  
  // Создаем папку для временных файлов
  const tempDir = path.join(__dirname, 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  // Скачиваем изображение
  const imagePath = path.join(tempDir, 'post_image.jpg');
  await downloadImage(postData.imageUrl, imagePath);
  
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/nix/store/58gnnsq47bm8zw871chaxm65zrnmnw53-ungoogled-chromium-108.0.5359.95/bin/chromium-browser',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--window-size=1920,1080',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=TranslateUI',
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-plugins',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor'
    ]
  });
  
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Устанавливаем User-Agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    console.log('🔐 Авторизация в Instagram...');
    
    // Переходим на страницу входа
    console.log('🌐 Переходим на страницу входа Instagram...');
    await page.goto('https://www.instagram.com/accounts/login/', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    // Ждем загрузки формы входа
    console.log('⏳ Ожидаем загрузки формы входа...');
    await page.waitForSelector('input[name="username"]', { timeout: 15000 });
    
    // Вводим данные для входа
    console.log('📝 Вводим учетные данные...');
    await page.type('input[name="username"]', INSTAGRAM_USERNAME, {delay: 100});
    await page.type('input[name="password"]', INSTAGRAM_PASSWORD, {delay: 100});
    
    // Нажимаем кнопку входа
    console.log('🔐 Нажимаем кнопку входа...');
    await page.click('button[type="submit"]');
    
    // Ждем перехода на главную страницу
    console.log('⏳ Ожидаем авторизации...');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
    
    console.log('✅ Авторизация успешна');
    
    // Проверяем текущий URL для подтверждения авторизации
    const currentUrl = page.url();
    console.log('📍 Текущий URL:', currentUrl);
    
    // Проверяем, не появилось ли предупреждение о подозрительной активности
    try {
      console.log('🔍 Проверяем наличие дополнительных диалогов...');
      await page.waitForTimeout(3000);
      
      // Попробуем найти кнопку "Not Now" или "Не сейчас"
      const notNowButton = await page.$('button:contains("Not Now"), button:contains("Не сейчас")');
      if (notNowButton) {
        console.log('🔘 Нажимаем "Not Now"');
        await notNowButton.click();
        await page.waitForTimeout(2000);
      }
    } catch (e) {
      console.log('⚠️ Дополнительные диалоги не найдены');
    }
    
    console.log('📝 Создаю новый пост...');
    
    // Нажимаем на кнопку создания поста
    await page.waitForSelector('svg[aria-label="New post"]', { timeout: 10000 });
    await page.click('svg[aria-label="New post"]');
    
    // Ждем появления диалога загрузки
    await page.waitForSelector('input[type="file"]', { timeout: 10000 });
    
    // Загружаем изображение
    const fileInput = await page.$('input[type="file"]');
    await fileInput.uploadFile(imagePath);
    
    console.log('🖼️ Изображение загружено');
    
    // Ждем обработки изображения и нажимаем "Next"
    await page.waitForTimeout(3000);
    await page.waitForSelector('button:contains("Next")', { timeout: 10000 });
    await page.click('button:contains("Next")');
    
    // Ждем страницы редактирования и нажимаем "Next" снова
    await page.waitForTimeout(2000);
    await page.waitForSelector('button:contains("Next")', { timeout: 10000 });
    await page.click('button:contains("Next")');
    
    // Ждем страницы с описанием
    await page.waitForTimeout(2000);
    await page.waitForSelector('textarea[aria-label="Write a caption..."]', { timeout: 10000 });
    
    // Вводим описание поста
    await page.type('textarea[aria-label="Write a caption..."]', postData.caption);
    
    console.log('📝 Описание добавлено');
    
    // Публикуем пост
    await page.waitForSelector('button:contains("Share")', { timeout: 10000 });
    await page.click('button:contains("Share")');
    
    // Ждем подтверждения публикации
    await page.waitForSelector('span:contains("Your post has been shared")', { timeout: 15000 });
    
    console.log('🎉 Пост успешно опубликован в Instagram!');
    
    // Получаем URL поста (если возможно)
    let postUrl = null;
    try {
      await page.waitForTimeout(2000);
      postUrl = page.url();
    } catch (e) {
      console.log('⚠️ Не удалось получить URL поста');
    }
    
    // Очищаем временные файлы
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }
    
    return {
      success: true,
      postUrl: postUrl,
      message: 'Пост успешно опубликован в Instagram'
    };
    
  } catch (error) {
    console.error('❌ Ошибка при публикации:', error.message);
    
    // Очищаем временные файлы в случае ошибки
    const imagePath = path.join(__dirname, 'temp', 'post_image.jpg');
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }
    
    return {
      success: false,
      error: error.message,
      message: 'Ошибка при публикации в Instagram'
    };
  } finally {
    await browser.close();
  }
}

// Запуск публикации
async function main() {
  console.log('🚀 Начинаю тест прямой публикации в Instagram...');
  console.log('📝 Данные поста:', {
    caption: testPost.caption,
    imageUrl: testPost.imageUrl
  });
  
  try {
    const result = await publishToInstagram(testPost);
    console.log('📊 Результат:', result);
    
    if (result.success) {
      console.log('🎉 ТЕСТ УСПЕШЕН! Instagram пост опубликован!');
      if (result.postUrl) {
        console.log('🔗 URL поста:', result.postUrl);
      }
    } else {
      console.log('❌ ТЕСТ НЕУСПЕШЕН:', result.error);
    }
  } catch (error) {
    console.error('❌ Критическая ошибка:', error.message);
  }
}

// Запуск если файл выполняется напрямую
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

export { publishToInstagram, testPost };