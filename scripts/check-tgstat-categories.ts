import puppeteer from 'puppeteer';
import fs from 'fs';

const cookiesPath = './tgstat-cookies.json';
const categoriesToCheck = [
  'blogs', 'news', 'humor', 'tech', 'economy', 'business', 'crypto', 'travel',
  'marketing', 'psychology', 'design', 'politics', 'art', 'law', 'education',
  'books', 'linguistics', 'career', 'courses', 'sport', 'fashion', 'medicine',
  'health', 'pictures', 'software', 'video', 'music', 'games', 'food', 'quotes',
  'crafts', 'finance'
];

async function checkCategories() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
  });
  
  const page = await browser.newPage();
  
  // Устанавливаем User-Agent как реальный браузер
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  // Загружаем куки
  if (fs.existsSync(cookiesPath)) {
    const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf-8'));
    console.log(`Загружено ${cookies.length} кук`);
    await page.setCookie(...cookies);
  } else {
    console.log('❌ Файл кук не найден!');
    await browser.close();
    return;
  }
  
  const valid: string[] = [];
  const invalid: string[] = [];
  
  for (const cat of categoriesToCheck) {
    const url = `https://tgstat.ru/channels/${cat}`;
    try {
      const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
      const status = response?.status() || 0;
      const content = await page.content();
      const is404 = content.includes('404') || content.includes('не существует');
      
      if (status === 200 && !is404) {
        valid.push(cat);
        console.log(`✅ ${cat}`);
      } else {
        invalid.push(cat);
        console.log(`❌ ${cat} (${status}${is404 ? ' 404-page' : ''})`);
      }
    } catch (e: any) {
      invalid.push(cat);
      console.log(`❌ ${cat} (${e.message?.substring(0, 50)})`);
    }
    await new Promise(r => setTimeout(r, 500));
  }
  
  console.log('\n=== РЕЗУЛЬТАТ ===');
  console.log(`Валидных: ${valid.length}`);
  if (valid.length > 0) console.log(`  ${valid.join(', ')}`);
  console.log(`Невалидных: ${invalid.length}`);
  if (invalid.length > 0) console.log(`  ${invalid.join(', ')}`);
  
  await browser.close();
}

checkCategories().catch(console.error);
