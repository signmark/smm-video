const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // Login
  await page.goto('https://smm.omemo.tech/login');
  await page.fill('input[type="email"], input[placeholder*="email"]', 'lbrspb@gmail.com');
  await page.fill('input[type="password"], input[placeholder*="пароль"]', 'QtpZ3dh7');
  await page.click('button:has-text("Войти")');
  await page.waitForTimeout(3000);
  
  // Close cookie
  const cookie = page.locator('button:has-text("Принять все")').first();
  if (await cookie.isVisible({timeout:2000}).catch(()=>false)) await cookie.click();
  await page.waitForTimeout(500);
  
  // Go to trends
  await page.goto('https://smm.omemo.tech/trends');
  await page.waitForTimeout(4000);
  
  // Get page content
  const text = await page.textContent('body');
  console.log('Page has trend content:', text.includes('Тренд') || text.includes('тренд'));
  console.log('Page has sources:', text.includes('Источник') || text.includes('источник'));
  console.log('Page has keywords:', text.includes('Ключев') || text.includes('ключев'));
  
  // Get all buttons text
  const btns = await page.locator('button').allTextContents();
  const meaningful = btns.filter(t => t.trim().length > 0 && t.trim().length < 60);
  console.log('Buttons:', meaningful);
  
  await page.screenshot({ path: '/tmp/smm-ui-test/trends-full.png', fullPage: true });
  
  // Try collect sources
  const collectBtn = page.locator('button:has-text("Собрать источники")').first();
  if (await collectBtn.isVisible({timeout:2000}).catch(()=>false)) {
    console.log('Clicking collect sources...');
    await collectBtn.click();
    await page.waitForTimeout(8000);
    await page.screenshot({ path: '/tmp/smm-ui-test/trends-after-collect.png', fullPage: true });
    const afterText = await page.textContent('body');
    console.log('After collect text preview:', afterText.substring(0, 200));
  } else {
    console.log('Collect sources button NOT found');
  }
  
  await browser.close();
  console.log('DONE');
})();
