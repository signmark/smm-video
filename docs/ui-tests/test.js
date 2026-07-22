const { chromium } = require('playwright');
const fs = require('fs');

const findings = [];
const SCREENSHOT_DIR = '/tmp/smm-ui-test';

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

function log(category, message, severity = 'info') {
  const entry = { category, message, severity, time: new Date().toISOString() };
  findings.push(entry);
  console.log(`[${severity.toUpperCase()}] [${category}] ${message}`);
}

async function screenshot(page, name) {
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png`, fullPage: true });
}

async function checkConsoleErrors(page, label) {
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.waitForTimeout(1500);
  if (errors.length > 0) {
    log('console', `${label}: ${errors.length} errors — ${errors.slice(0, 3).join('; ')}`, 'warn');
  } else {
    log('console', `${label}: no errors`, 'info');
  }
  page.removeAllListeners('console');
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  // ===== LOGIN =====
  log('auth', 'Starting login flow');
  await page.goto('https://smm.omemo.tech/login');
  await page.fill('input[type="email"], input[placeholder*="email"]', 'lbrspb@gmail.com');
  await page.fill('input[type="password"], input[placeholder*="пароль"]', 'QtpZ3dh7');
  await page.click('button:has-text("Войти")');
  await page.waitForTimeout(3000);
  
  const loginUrl = page.url();
  if (loginUrl.includes('/campaigns') || loginUrl.includes('/dashboard')) {
    log('auth', 'Login successful, redirected to: ' + loginUrl, 'pass');
  } else {
    log('auth', 'Login may have failed, URL: ' + loginUrl, 'fail');
  }
  await screenshot(page, '01-after-login');

  // ===== CAMPAIGNS LIST =====
  log('campaigns', 'Testing campaigns list');
  await page.goto('https://smm.omemo.tech/campaigns');
  await page.waitForTimeout(2000);
  const campaignCards = await page.$$('.card, [class*="Card"]');
  log('campaigns', `Found ${campaignCards.length} campaign cards`);
  await screenshot(page, '02-campaigns-list');

  // ===== CREATE CAMPAIGN =====
  log('campaigns', 'Testing campaign creation');
  const createBtn = page.locator('button:has-text("Создать кампанию")');
  if (await createBtn.isVisible()) {
    await createBtn.click();
    await page.waitForTimeout(2000);
    await screenshot(page, '03-create-campaign-dialog');
    
    // Fill form
    const nameInput = page.locator('input[placeholder*="название"], input[name*="name"]').first();
    if (await nameInput.isVisible()) {
      await nameInput.fill('UI-Test Campaign ' + Date.now());
      log('campaigns', 'Filled campaign name', 'pass');
      
      // Look for save/submit button
      const saveBtn = page.locator('button:has-text("Создать"), button:has-text("Сохранить"), button[type="submit"]').first();
      if (await saveBtn.isVisible()) {
        await saveBtn.click();
        await page.waitForTimeout(3000);
        log('campaigns', 'Submitted campaign creation', 'pass');
        await screenshot(page, '04-after-campaign-create');
      }
    }
  } else {
    log('campaigns', 'Create campaign button not found', 'fail');
  }

  // ===== CONTENT PAGE =====
  log('content', 'Testing content page');
  await page.goto('https://smm.omemo.tech/content');
  await page.waitForTimeout(3000);
  await checkConsoleErrors(page, 'content');
  await screenshot(page, '05-content-page');

  // Check tabs
  const tabs = ['Все', 'Черновики', 'Запланированные', 'Опубликованные'];
  for (const tab of tabs) {
    const tabBtn = page.locator(`button:has-text("${tab}"), [role="tab"]:has-text("${tab}")`).first();
    if (await tabBtn.isVisible()) {
      await tabBtn.click();
      await page.waitForTimeout(1500);
      log('content', `Tab "${tab}" clicked`, 'pass');
    }
  }
  await screenshot(page, '06-content-tabs');

  // ===== CREATE CONTENT =====
  log('content', 'Testing content creation');
  const createContentBtn = page.locator('button:has-text("Создать контент")').first();
  if (await createContentBtn.isVisible()) {
    await createContentBtn.click();
    await page.waitForTimeout(2000);
    await screenshot(page, '07-create-content-dialog');
    await checkConsoleErrors(page, 'create-content-dialog');
    
    // Try to close dialog
    const closeBtn = page.locator('button[aria-label="Close"], button:has-text("Отмена"), [data-dialog-close]').first();
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
      await page.waitForTimeout(500);
    } else {
      await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(500);
  }

  // ===== SCHEDULED PAGE =====
  log('scheduled', 'Testing scheduled page');
  await page.goto('https://smm.omemo.tech/publish/scheduled');
  await page.waitForTimeout(3000);
  await checkConsoleErrors(page, 'scheduled');
  await screenshot(page, '08-scheduled-page');

  // ===== PUBLICATIONS PAGE =====
  log('publications', 'Testing publications page');
  await page.goto('https://smm.omemo.tech/posts');
  await page.waitForTimeout(3000);
  await checkConsoleErrors(page, 'publications');
  await screenshot(page, '09-publications-page');

  // ===== ANALYTICS PAGE =====
  log('analytics', 'Testing analytics page');
  await page.goto('https://smm.omemo.tech/analytics');
  await page.waitForTimeout(3000);
  await checkConsoleErrors(page, 'analytics');
  
  // Try period selector
  const periodSelector = page.locator('select, [role="combobox"]').first();
  if (await periodSelector.isVisible()) {
    await periodSelector.click();
    await page.waitForTimeout(500);
    log('analytics', 'Period selector visible', 'pass');
  }
  await screenshot(page, '10-analytics-page');

  // ===== TRENDS PAGE =====
  log('trends', 'Testing trends page');
  await page.goto('https://smm.omemo.tech/trends');
  await page.waitForTimeout(3000);
  await checkConsoleErrors(page, 'trends');
  await screenshot(page, '11-trends-page');

  // ===== CAMPAIGN SETTINGS =====
  log('settings', 'Testing campaign settings');
  await page.goto('https://smm.omemo.tech/content');
  await page.waitForTimeout(2000);
  // Click on campaign selector or settings
  const settingsLink = page.locator('a:has-text("Настройки"), button:has-text("Настройки")').first();
  if (await settingsLink.isVisible()) {
    await settingsLink.click();
    await page.waitForTimeout(2000);
    await screenshot(page, '12-campaign-settings');
    await checkConsoleErrors(page, 'campaign-settings');
  }

  // ===== ADMIN PAGES =====
  log('admin', 'Testing admin pages');
  
  // API Keys
  await page.goto('https://smm.omemo.tech/api-keys');
  await page.waitForTimeout(2000);
  await checkConsoleErrors(page, 'api-keys');
  await screenshot(page, '13-api-keys');

  // Users
  await page.goto('https://smm.omemo.tech/users');
  await page.waitForTimeout(2000);
  await checkConsoleErrors(page, 'users');
  await screenshot(page, '14-users');

  // TG Channels
  await page.goto('https://smm.omemo.tech/telegram-channels');
  await page.waitForTimeout(2000);
  await checkConsoleErrors(page, 'tg-channels');
  await screenshot(page, '15-tg-channels');

  // ===== SOCIAL MEDIA SETTINGS =====
  log('social', 'Testing social media settings');
  await page.goto('https://smm.omemo.tech/content');
  await page.waitForTimeout(2000);
  // Look for social settings button
  const socialBtn = page.locator('button:has-text("Настроить социальные сети"), a:has-text("Социальные сети")').first();
  if (await socialBtn.isVisible()) {
    await socialBtn.click();
    await page.waitForTimeout(2000);
    await screenshot(page, '16-social-settings');
  }

  // ===== MAIN DASHBOARD =====
  log('dashboard', 'Testing main dashboard');
  await page.goto('https://smm.omemo.tech/dashboard');
  await page.waitForTimeout(3000);
  await checkConsoleErrors(page, 'dashboard');
  await screenshot(page, '17-dashboard');

  // ===== HOME PAGE =====
  await page.goto('https://smm.omemo.tech/');
  await page.waitForTimeout(2000);
  await screenshot(page, '18-home');

  // ===== 404 TEST =====
  log('routing', 'Testing 404 handling');
  await page.goto('https://smm.omemo.tech/nonexistent-page');
  await page.waitForTimeout(2000);
  await screenshot(page, '19-404');
  const is404orRedirect = page.url().includes('login') || (await page.textContent('body')).includes('404') || (await page.textContent('body')).includes('не найден');
  log('routing', `Non-existent page: ${is404orRedirect ? 'handled' : 'may show blank'}`, is404orRedirect ? 'pass' : 'warn');

  // ===== MOBILE VIEWPORT =====
  log('responsive', 'Testing mobile viewport');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('https://smm.omemo.tech/content');
  await page.waitForTimeout(3000);
  await screenshot(page, '20-mobile-content');
  
  await page.goto('https://smm.omemo.tech/analytics');
  await page.waitForTimeout(3000);
  await screenshot(page, '21-mobile-analytics');

  // Save findings
  fs.writeFileSync(`${SCREENSHOT_DIR}/findings.json`, JSON.stringify(findings, null, 2));
  fs.writeFileSync(`${SCREENSHOT_DIR}/findings.md`, findings.map(f => 
    `| ${f.severity.toUpperCase()} | ${f.category} | ${f.message} |`
  ).join('\n'));

  await browser.close();
  console.log('\n=== SUMMARY ===');
  console.log(`Total checks: ${findings.length}`);
  console.log(`Pass: ${findings.filter(f => f.severity === 'pass').length}`);
  console.log(`Warn: ${findings.filter(f => f.severity === 'warn').length}`);
  console.log(`Fail: ${findings.filter(f => f.severity === 'fail').length}`);
})();
