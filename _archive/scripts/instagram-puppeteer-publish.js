/**
 * Публикация в Instagram через Puppeteer браузерную автоматизацию
 * Без использования API - только имитация действий пользователя
 */
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import axios from 'axios';

const INSTAGRAM_USERNAME = 'it.zhdanov';
const INSTAGRAM_PASSWORD = process.env.INSTAGRAM_TEST_PASSWORD;

async function downloadImage(imageUrl, savePath) {
  console.log(`📥 Скачиваем изображение: ${imageUrl}`);
  
  const response = await axios({
    method: 'GET',
    url: imageUrl,
    responseType: 'stream'
  });
  
  const writer = fs.createWriteStream(savePath);
  response.data.pipe(writer);
  
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

async function publishToInstagram(imageUrl, caption) {
  console.log('🚀 Запускаем публикацию в Instagram через браузер...');
  
  // Настройки браузера для Replit
  const browserOptions = {
    headless: true,
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
      '--disable-features=VizDisplayCompositor',
      '--window-size=1920,1080'
    ],
    executablePath: '/nix/store/58gnnsq47bm8zw871chaxm65zrnmnw53-ungoogled-chromium-108.0.5359.95/bin/chromium-browser'
  };
  
  const browser = await puppeteer.launch(browserOptions);
  
  try {
    const page = await browser.newPage();
    
    // Устанавливаем User-Agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Скачиваем изображение локально
    const imagePath = path.join(process.cwd(), 'temp-image.jpg');
    await downloadImage(imageUrl, imagePath);
    console.log('✅ Изображение скачано:', imagePath);
    
    // Переходим на Instagram
    console.log('📱 Открываем Instagram...');
    await page.goto('https://www.instagram.com/', { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });
    
    // Ждем поля входа
    console.log('🔍 Ищем поля для входа...');
    await page.waitForSelector('input[name="username"]', { timeout: 15000 });
    
    // Вводим данные для входа
    console.log('🔑 Вводим логин и пароль...');
    await page.type('input[name="username"]', INSTAGRAM_USERNAME, { delay: 100 });
    await page.type('input[name="password"]', INSTAGRAM_PASSWORD, { delay: 100 });
    
    // Нажимаем кнопку входа
    console.log('🚪 Входим в аккаунт...');
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 })
    ]);
    
    console.log('✅ Авторизация успешна!');
    
    // Проверяем, не появились ли дополнительные диалоги
    try {
      // Отклоняем уведомления, если появятся
      await page.waitForSelector('button', { timeout: 5000 });
      const notNowButtons = await page.$$('button');
      for (const button of notNowButtons) {
        const text = await page.evaluate(el => el.textContent, button);
        if (text && text.toLowerCase().includes('not now')) {
          await button.click();
          break;
        }
      }
    } catch (e) {
      // Игнорируем, если диалогов нет
    }
    
    // Ищем кнопку создания поста
    console.log('📝 Ищем кнопку создания поста...');
    
    // Различные селекторы для кнопки создания
    const createSelectors = [
      'a[href*="/create/"]',
      'svg[aria-label*="New post"]',
      'svg[aria-label*="Новая публикация"]',
      '[aria-label*="Create"]',
      'div[role="menuitem"]'
    ];
    
    let createButton = null;
    for (const selector of createSelectors) {
      try {
        createButton = await page.$(selector);
        if (createButton) {
          console.log(`✅ Найдена кнопка создания: ${selector}`);
          break;
        }
      } catch (e) {
        // Продолжаем поиск
      }
    }
    
    if (!createButton) {
      // Пытаемся найти по тексту
      const allButtons = await page.$$('a, button, div[role="button"]');
      for (const button of allButtons) {
        try {
          const text = await page.evaluate(el => el.textContent || '', button);
          const ariaLabel = await page.evaluate(el => el.getAttribute('aria-label') || '', button);
          
          if (text.toLowerCase().includes('create') || 
              ariaLabel.toLowerCase().includes('create') ||
              ariaLabel.toLowerCase().includes('new post')) {
            createButton = button;
            console.log('✅ Найдена кнопка создания по тексту');
            break;
          }
        } catch (e) {
          // Игнорируем ошибки
        }
      }
    }
    
    if (createButton) {
      await createButton.click();
      console.log('🎨 Кнопка создания поста нажата!');
      
      // Ждем загрузки страницы создания
      await page.waitForTimeout(3000);
      
      // Ищем поле для загрузки файла
      console.log('📎 Ищем поле загрузки файла...');
      
      const fileInput = await page.$('input[type="file"]');
      if (fileInput) {
        console.log('📤 Загружаем изображение...');
        await fileInput.uploadFile(imagePath);
        
        // Ждем обработки изображения
        await page.waitForTimeout(5000);
        
        // Ищем кнопку "Далее" или "Next"
        console.log('➡️ Ищем кнопку "Далее"...');
        
        const nextButtons = await page.$$('button');
        for (const button of nextButtons) {
          const text = await page.evaluate(el => el.textContent, button);
          if (text && (text.includes('Next') || text.includes('Далее') || text.includes('Поделиться'))) {
            await button.click();
            console.log('✅ Нажата кнопка:', text);
            await page.waitForTimeout(2000);
            break;
          }
        }
        
        // Добавляем подпись
        console.log('✍️ Добавляем подпись к посту...');
        
        const textareas = await page.$$('textarea');
        if (textareas.length > 0) {
          await textareas[0].type(caption, { delay: 50 });
          console.log('✅ Подпись добавлена');
        }
        
        // Публикуем пост
        console.log('🚀 Публикуем пост...');
        
        const publishButtons = await page.$$('button');
        for (const button of publishButtons) {
          const text = await page.evaluate(el => el.textContent, button);
          if (text && (text.includes('Share') || text.includes('Поделиться') || text.includes('Опубликовать'))) {
            await button.click();
            console.log('🎉 Пост опубликован!');
            
            // Ждем подтверждения
            await page.waitForTimeout(5000);
            
            // Попытка получить URL поста
            const currentUrl = page.url();
            if (currentUrl.includes('instagram.com/p/')) {
              console.log('🔗 URL поста:', currentUrl);
              return {
                success: true,
                postUrl: currentUrl,
                message: 'Пост успешно опубликован'
              };
            }
            
            return {
              success: true,
              message: 'Пост опубликован, но URL не получен'
            };
          }
        }
        
        return {
          success: false,
          error: 'Не найдена кнопка публикации'
        };
        
      } else {
        return {
          success: false,
          error: 'Не найдено поле загрузки файла'
        };
      }
      
    } else {
      return {
        success: false,
        error: 'Не найдена кнопка создания поста'
      };
    }
    
  } catch (error) {
    console.error('❌ Ошибка при публикации:', error.message);
    
    // Сохраняем скриншот для отладки
    try {
      await page.screenshot({ path: 'instagram-error-screenshot.png', fullPage: true });
      console.log('📷 Скриншот ошибки сохранен');
    } catch (e) {
      // Игнорируем ошибки скриншота
    }
    
    return {
      success: false,
      error: error.message
    };
    
  } finally {
    // Удаляем временное изображение
    try {
      fs.unlinkSync(imagePath);
      console.log('🗑️ Временное изображение удалено');
    } catch (e) {
      // Игнорируем ошибки удаления
    }
    
    await browser.close();
    console.log('🏁 Браузер закрыт');
  }
}

// Функция для простого тестирования
async function testInstagramPublish() {
  const testImageUrl = 'https://i.imgur.com/KNJnIR9.jpg'; // Простое квадратное изображение
  const testCaption = '🚀 Тестовая публикация через автоматизацию браузера!\n\n#test #automation #instagram';
  
  console.log('🧪 Запускаем тестовую публикацию...');
  console.log('🖼️ Изображение:', testImageUrl);
  console.log('✍️ Подпись:', testCaption);
  
  const result = await publishToInstagram(testImageUrl, testCaption);
  
  console.log('\n📊 Результат:');
  console.log(JSON.stringify(result, null, 2));
  
  return result;
}

// Экспорт функций
export { publishToInstagram, testInstagramPublish };

// Если файл запускается напрямую, выполняем тест
if (import.meta.url === `file://${process.argv[1]}`) {
  testInstagramPublish();
}
