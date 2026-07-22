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

async function ss(page, name) {
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png`, fullPage: true });
}

async function dismissOverlays(page) {
  // Close cookie banner
  const cookieAccept = page.locator('button:has-text("Принять все"), button:has-text("Accept all")').first();
  if (await cookieAccept.isVisible({ timeout: 2000 }).catch(() => false)) {
    await cookieAccept.click();
    await page.waitForTimeout(500);
    log('overlay', 'Cookie banner dismissed', 'pass');
  }
  // Close any dialog overlays
  const overlay = page.locator('.fixed.inset-0.bg-black\\/80, [data-state="open"][aria-hidden="true"]').first();
  if (await overlay.isVisible({ timeout: 1000 }).catch(() => false)) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    log('overlay', 'Overlay dismissed via Escape', 'pass');
  }
}

async function safeClick(page, selector, label) {
  try {
    await dismissOverlays(page);
    const el = page.locator(selector).first();
    await el.click({ timeout: 5000 });
    log('click', label, 'pass');
    return true;
  } catch (e) {
    log('click', `${label}: ${e.message.split('\n')[0]}`, 'fail');
    return false;
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  // ===== LOGIN =====
  log('auth', 'Starting login');
  await page.goto('https://smm.omemo.tech/login');
  await page.fill('input[type="email"], input[placeholder*="email"]', 'lbrspb@gmail.com');
  await page.fill('input[type="password"], input[placeholder*="пароль"]', 'QtpZ3dh7');
  await page.click('button:has-text("Войти")');
  await page.waitForTimeout(3000);
  await dismissOverlays(page);
  log('auth', `Login → ${page.url()}`, page.url().includes('/campaigns') ? 'pass' : 'fail');
  await ss(page, '01-after-login');

  // ===== CAMPAIGNS =====
  log('campaigns', 'List');
  await page.goto('https://smm.omemo.tech/campaigns');
  await page.waitForTimeout(2000);
  await dismissOverlays(page);
  const cards = await page.$$eval('[class*="Card"], [class*="card"]', els => els.length);
  log('campaigns', `${cards} cards found`);
  await ss(page, '02-campaigns');

  // ===== CREATE CAMPAIGN =====
  log('campaigns', 'Create dialog');
  await safeClick(page, 'button:has-text("Создать кампанию")', 'open create dialog');
  await page.waitForTimeout(2000);
  await ss(page, '03-create-dialog');
  
  const nameInput = page.locator('input[placeholder*="название"], input[name*="name"], input[id*="name"]').first();
  if (await nameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await nameInput.fill('UI-Test-' + Date.now());
    log('campaigns', 'Name filled', 'pass');
    // Find submit in dialog
    const submitBtn = page.locator('[role="dialog"] button[type="submit"], [role="dialog"] button:has-text("Создать"), [role="dialog"] button:has-text("Сохранить")').first();
    if (await submitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await submitBtn.click();
      await page.waitForTimeout(3000);
      log('campaigns', 'Submitted', 'pass');
    } else {
      log('campaigns', 'Submit button not found in dialog', 'warn');
    }
  }
  await ss(page, '04-after-create');
  await dismissOverlays(page);

  // ===== CONTENT =====
  log('content', 'Page');
  await page.goto('https://smm.omemo.tech/content');
  await page.waitForTimeout(3000);
  await dismissOverlays(page);
  await ss(page, '05-content');

  // Content tabs
  for (const tab of ['Черновики', 'Запланированные', 'Опубликованные', 'Все']) {
    const tabBtn = page.locator(`button:has-text("${tab}"), [role="tab"]:has-text("${tab}")`).first();
    if (await tabBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await tabBtn.click();
      await page.waitForTimeout(1000);
      log('content', `Tab "${tab}"`, 'pass');
    }
  }
  await ss(page, '06-content-tabs');

  // Create content dialog
  log('content', 'Create dialog');
  await safeClick(page, 'button:has-text("Создать контент")', 'open create content');
  await page.waitForTimeout(2000);
  await ss(page, '07-create-content');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // ===== SCHEDULED =====
  log('scheduled', 'Page');
  await page.goto('https://smm.omemo.tech/publish/scheduled');
  await page.waitForTimeout(3000);
  await dismissOverlays(page);
  await ss(page, '08-scheduled');

  // ===== PUBLICATIONS =====
  log('publications', 'Page');
  await page.goto('https://smm.omemo.tech/posts');
  await page.waitForTimeout(3000);
  await dismissOverlays(page);
  // Try clicking a date on the calendar
  const date13 = page.locator('button:has-text("13")').first();
  if (await date13.isVisible({ timeout: 1000 }).catch(() => false)) {
    await date13.click();
    await page.waitForTimeout(1500);
    log('publications', 'Calendar date 13 clicked', 'pass');
  }
  await ss(page, '09-publications');

  // ===== ANALYTICS =====
  log('analytics', 'Page');
  await page.goto('https://smm.omemo.tech/analytics');
  await page.waitForTimeout(3000);
  await dismissOverlays(page);
  // Period selector
  const periodSel = page.locator('select, [role="combobox"]').first();
  if (await periodSel.isVisible({ timeout: 2000 }).catch(() => false)) {
    await periodSel.click();
    await page.waitForTimeout(500);
    // Select 30 days
    const opt30 = page.locator('option:has-text("30"), [role="option"]:has-text("30"), [value="30days"]').first();
    if (await opt30.isVisible({ timeout: 1000 }).catch(() => false)) {
      await opt30.click();
      await page.waitForTimeout(2000);
      log('analytics', 'Switched to 30 days', 'pass');
    }
  }
  await ss(page, '10-analytics');

  // ===== TRENDS =====
  log('trends', 'Page');
  await page.goto('https://smm.omemo.tech/trends');
  await page.waitForTimeout(3000);
  await dismissOverlays(page);
  await ss(page, '11-trends');

  // Try collect sources
  const collectBtn = page.locator('button:has-text("Собрать"), button:has-text("Собрать источники")').first();
  if (await collectBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    log('trends', 'Collect button visible', 'pass');
    await ss(page, '12-trends-collect-btn');
  }

  // ===== SETTINGS / SOCIAL =====
  log('settings', 'Social settings');
  await page.goto('https://smm.omemo.tech/content');
  await page.waitForTimeout(2000);
  await dismissOverlays(page);
  // Look for social settings in campaign settings
  const settingsNav = page.locator('a:has-text("Настройки"), button:has-text("Настройки")').first();
  if (await settingsNav.isVisible({ timeout: 1000 }).catch(() => false)) {
    await settingsNav.click();
    await page.waitForTimeout(2000);
    await dismissOverlays(page);
    await ss(page, '13-settings');
    await checkConsoleErrors(page, 'settings');
  }

  // ===== ADMIN =====
  for (const [name, url] of [
    ['api-keys', '/api-keys'],
    ['users', '/users'],
    ['tg-channels', '/telegram-channels'],
  ]) {
    log('admin', name);
    await page.goto(`https://smm.omemo.tech${url}`);
    await page.waitForTimeout(2000);
    await dismissOverlays(page);
    await ss(page, `14-${name}`);
    await checkConsoleErrors(page, name);
  }

  // ===== DASHBOARD =====
  log('dashboard', 'Page');
  await page.goto('https://smm.omemo.tech/dashboard');
  await page.waitForTimeout(3000);
  await dismissOverlays(page);
  await ss(page, '15-dashboard');

  // ===== MOBILE =====
  log('responsive', 'Mobile viewport');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('https://smm.omemo.tech/content');
  await page.waitForTimeout(3000);
  await dismissOverlays(page);
  await ss(page, '16-mobile-content');
  await page.goto('https://smm.omemo.tech/analytics');
  await page.waitForTimeout(3000);
  await dismissOverlays(page);
  await ss(page, '17-mobile-analytics');

  // ===== LOGOUT =====
  log('auth', 'Logout');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('https://smm.omemo.tech/content');
  await page.waitForTimeout(2000);
  await dismissOverlays(page);
  const logoutBtn = page.locator('button:has-text("Выйти"), button:has-text("Logout")').first();
  if (await logoutBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await logoutBtn.click();
    await page.waitForTimeout(2000);
    log('auth', `Logout → ${page.url()}`, page.url().includes('/login') ? 'pass' : 'warn');
  }

  // ===== SAVE FINDINGS =====
  fs.writeFileSync(`${SCREENSHOT_DIR}/findings.json`, JSON.stringify(findings, null, 2));
  
  const md = `# UI Test Report — ${new Date().toISOString()}\n\n` +
    `| Severity | Category | Message |\n|---|---|---|\n` +
    findings.map(f => `| ${f.severity.toUpperCase()} | ${f.category} | ${f.message} |`).join('\n');
  fs.writeFileSync(`${SCREENSHOT_DIR}/findings.md`, md);

  await browser.close();
  
  console.log('\n=== SUMMARY ===');
  console.log(`Total: ${findings.length}`);
  console.log(`Pass: ${findings.filter(f => f.severity === 'pass').length}`);
  console.log(`Info: ${findings.filter(f => f.severity === 'info').length}`);
  console.log(`Warn: ${findings.filter(f => f.severity === 'warn').length}`);
  console.log(`Fail: ${findings.filter(f => f.severity === 'fail').length}`);
})();

async function checkConsoleErrors(page, label) {
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.waitForTimeout(1500);
  if (errors.length > 0) {
    log('console', `${label}: ${errors.length} errors — ${errors.slice(0, 2).join('; ')}`, 'warn');
  }
  page.removeAllListeners('console');
}
