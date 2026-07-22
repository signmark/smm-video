const { chromium } = require('playwright');
const fs = require('fs');

const findings = [];
const BUGS = [];
const DIR = '/tmp/smm-ui-full';
fs.mkdirSync(DIR, { recursive: true });

function log(category, message, severity = 'info') {
  findings.push({ category, message, severity, time: new Date().toISOString() });
  console.log(`[${severity.toUpperCase()}] [${category}] ${message}`);
}

function bug(category, message, impact = 'medium') {
  BUGS.push({ category, message, impact, time: new Date().toISOString() });
  log(category, `BUG: ${message}`, 'fail');
}

async function ss(page, name) {
  await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: true });
}

async function dismissOverlays(page) {
  try {
    const cookie = page.locator('button:has-text("Принять все")').first();
    if (await cookie.isVisible({ timeout: 1500 }).catch(() => false)) {
      await cookie.click();
      await page.waitForTimeout(300);
    }
  } catch {}
}

async function waitForToast(page, timeoutMs = 8000) {
  try {
    const toast = page.locator('[role="status"], [class*="toast"], [class*="sonner"]').first();
    await toast.waitFor({ state: 'visible', timeout: timeoutMs });
    const text = await toast.textContent();
    await page.waitForTimeout(1000);
    return text;
  } catch { return null; }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();

  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push(`PAGE: ${err.message}`));

  // ===== LOGIN =====
  log('auth', 'Login');
  await page.goto('https://smm.omemo.tech/login');
  await page.fill('input[type="email"], input[placeholder*="email"]', 'lbrspb@gmail.com');
  await page.fill('input[type="password"], input[placeholder*="пароль"]', 'QtpZ3dh7');
  await page.click('button:has-text("Войти")');
  await page.waitForTimeout(3000);
  await dismissOverlays(page);
  log('auth', `→ ${page.url()}`, page.url().includes('/campaigns') ? 'pass' : 'fail');

  // ===== STEP 1: CREATE FRESH CAMPAIGN =====
  log('campaign-create', '=== STEP 1: Create fresh campaign ===');
  await page.goto('https://smm.omemo.tech/campaigns');
  await page.waitForTimeout(2000);
  
  const createBtn = page.locator('button:has-text("Создать кампанию")').first();
  if (await createBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await createBtn.click();
    await page.waitForTimeout(1500);
    
    // Fill campaign name
    const nameInput = page.locator('[role="dialog"] input').first();
    if (await nameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      const campaignName = 'UI-Test-' + Date.now();
      await nameInput.fill(campaignName);
      log('campaign-create', `Name: ${campaignName}`);
      
      // Fill description if available
      const descInput = page.locator('[role="dialog"] textarea, [role="dialog"] input').nth(1);
      if (await descInput.isVisible({ timeout: 1000 }).catch(() => false)) {
        await descInput.fill('Автотест кампания для проверки UI');
      }
      
      // Submit
      const submitBtn = page.locator('[role="dialog"] button[type="submit"], [role="dialog"] button:has-text("Создать"), [role="dialog"] button:has-text("Сохранить")').first();
      if (await submitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await submitBtn.click();
        await page.waitForTimeout(3000);
        
        // Should redirect to campaign page
        const url = page.url();
        const isOnCampaign = url.includes('/campaigns/') && !url.endsWith('/campaigns');
        log('campaign-create', `After create → ${url}`, isOnCampaign ? 'pass' : 'warn');
        
        if (!isOnCampaign) {
          bug('campaign-create', 'After creating campaign, did not redirect to campaign page');
        }
        
        await ss(page, '01-campaign-created');
        
        // Extract campaign ID from URL
        const campaignId = url.match(/campaigns\/([a-f0-9-]+)/)?.[1];
        log('campaign-create', `Campaign ID: ${campaignId}`);
      }
    }
  }
  await ss(page, '02-campaign-page');

  // ===== STEP 2: CAMPAIGN PAGE — ALL SECTIONS =====
  log('campaign-sections', '=== STEP 2: Campaign sections ===');
  
  // Expand each section and test
  for (const [section, expectedContent] of [
    ['Сайт', 'URL'],
    ['Ключевые слова', 'ключевых слов'],
    ['Бизнес-анкета', 'Анкета'],
    ['Настройки анализа трендов', 'тренд'],
    ['Настройки публикации', 'Соцсети'],
    ['Генерация контента', 'Контент'],
    ['Настройки автономного ассистента', 'Ассистент'],
  ]) {
    const trigger = page.locator(`button:has-text("${section}"), [class*="accordion"]:has-text("${section}")`).first();
    if (await trigger.isVisible({ timeout: 1000 }).catch(() => false)) {
      try {
        await trigger.click();
        await page.waitForTimeout(600);
        const bodyText = await page.textContent('body');
        const hasContent = bodyText.toLowerCase().includes(expectedContent.toLowerCase());
        log('campaign-sections', `Section "${section}" — content visible: ${hasContent}`, hasContent ? 'pass' : 'warn');
      } catch (e) {
        log('campaign-sections', `Section "${section}" — click failed: ${e.message.split('\n')[0]}`, 'warn');
      }
    }
  }
  await ss(page, '03-all-sections-expanded');

  // ===== STEP 3: KEYWORDS — Full flow =====
  log('keywords', '=== STEP 3: Keywords full flow ===');
  
  // Expand keywords section
  const kwSection = page.locator('button:has-text("Ключевые слова")').first();
  if (await kwSection.isVisible({ timeout: 2000 }).catch(() => false)) {
    await kwSection.click();
    await page.waitForTimeout(800);
  }
  
  // Search for keywords
  const kwSearchInput = page.locator('input[placeholder*="ключев"], input[placeholder*="Введите"]').first();
  if (await kwSearchInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await kwSearchInput.fill('юмор');
    const searchBtn = page.locator('button:has-text("Поиск")').first();
    if (await searchBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await searchBtn.click();
      await page.waitForTimeout(3000);
      
      const bodyText = await page.textContent('body');
      const hasResults = bodyText.includes('Результаты поиска') || bodyText.includes('Частота');
      log('keywords', `Search for "юмор" results: ${hasResults}`, hasResults ? 'pass' : 'warn');
      
      if (hasResults) {
        // Select a keyword from results
        const selectCheckbox = page.locator('table input[type="checkbox"], [role="row"] input[type="checkbox"]').first();
        if (await selectCheckbox.isVisible({ timeout: 2000 }).catch(() => false)) {
          await selectCheckbox.click();
          await page.waitForTimeout(500);
          log('keywords', 'Keyword selected from results', 'pass');
        }
        
        // Click save selected
        const saveBtn = page.locator('button:has-text("Сохранить выбранные")').first();
        if (await saveBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await saveBtn.click();
          await page.waitForTimeout(2000);
          
          const toastText = await waitForToast(page);
          log('keywords', `Save toast: ${toastText || 'none'}`);
          
          // Check keyword count updated
          const bodyAfter = await page.textContent('body');
          const kwCount = bodyAfter.match(/Добавлено (\d+) ключевых слов/);
          log('keywords', `Keyword count after save: ${kwCount ? kwCount[1] : '0'}`);
          
          if (kwCount && parseInt(kwCount[1]) === 0) {
            bug('keywords', 'After saving keywords via UI, count still shows 0');
          }
        }
      }
    }
  }
  await ss(page, '04-keywords-saved');

  // ===== STEP 4: TREND ANALYSIS SETTINGS =====
  log('trend-settings', '=== STEP 4: Trend analysis settings ===');
  const trendSettings = page.locator('button:has-text("Настройки анализа трендов")').first();
  if (await trendSettings.isVisible({ timeout: 2000 }).catch(() => false)) {
    await trendSettings.click();
    await page.waitForTimeout(800);
    await ss(page, '05-trend-settings');
    
    // Check for editable fields
    const inputs = await page.locator('input[type="number"], input[type="range"]').all();
    log('trend-settings', `Settings inputs found: ${inputs.length}`);
    
    if (inputs.length === 0) {
      bug('trend-settings', 'No editable settings inputs in trend analysis settings section');
    }
  }

  // ===== STEP 5: TRENDS PAGE — Full flow =====
  log('trends', '=== STEP 5: Trends page ===');
  await page.goto('https://smm.omemo.tech/trends');
  await page.waitForTimeout(4000);
  await dismissOverlays(page);
  
  // Should auto-select the fresh campaign if it's the latest
  await ss(page, '06-trends-page');
  
  // Check TGStat input
  const tgstatInput = page.locator('input[placeholder*="TGStat"]').first();
  if (await tgstatInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    const val = await tgstatInput.inputValue();
    log('trends', `TGStat input value: "${val}"`, val ? 'pass' : 'warn');
    if (!val) {
      bug('trends', 'TGStat input empty — keywords not propagated to trends page');
    }
  }
  
  // Sources accordion
  const srcAccordion = page.locator('text="Источники данных"').first();
  if (await srcAccordion.isVisible({ timeout: 2000 }).catch(() => false)) {
    await srcAccordion.click();
    await page.waitForTimeout(1000);
    const bodyText = await page.textContent('body');
    const hasSources = bodyText.includes('Все источники') || bodyText.includes('Нет источников');
    log('trends', `Sources section: ${hasSources ? 'has content' : 'empty'}`);
  }
  
  // Trends accordion
  const trAccordion = page.locator('text="Тренды"').last();
  if (await trAccordion.isVisible({ timeout: 2000 }).catch(() => false)) {
    await trAccordion.click();
    await page.waitForTimeout(1000);
    const bodyText = await page.textContent('body');
    const countMatch = bodyText.match(/Всего трендов: (\d+)/);
    log('trends', `Trends count: ${countMatch ? countMatch[1] : '0'}`);
  }
  
  await ss(page, '07-trends-expanded');

  // Test "Collect Sources" flow
  log('trends', '--- Collect Sources flow ---');
  const collectSrc = page.locator('button:has-text("Собрать источники")').first();
  if (await collectSrc.isVisible({ timeout: 2000 }).catch(() => false)) {
    await collectSrc.click();
    await page.waitForTimeout(1500);
    
    // Dialog should appear
    const dialog = page.locator('[role="dialog"]').first();
    if (await dialog.isVisible({ timeout: 2000 }).catch(() => false)) {
      log('trends', 'Platform selection dialog opened', 'pass');
      await ss(page, '08-collect-dialog');
      
      // Check checkboxes
      const checks = ['Instagram', 'Telegram', 'ВКонтакте'];
      for (const name of checks) {
        const label = page.locator(`text="${name}"`).first();
        const visible = await label.isVisible({ timeout: 500 }).catch(() => false);
        log('trends', `  ${name} checkbox: ${visible ? 'visible' : 'hidden'}`);
      }
      
      // Check Facebook/YouTube (should be disabled)
      const fbLabel = page.locator('text="Facebook"').first();
      const fbVisible = await fbLabel.isVisible({ timeout: 500 }).catch(() => false);
      if (fbVisible) {
        const fbDisabled = await page.locator('text="Facebook"').first().isDisabled().catch(() => true);
        log('trends', `  Facebook: disabled=${fbDisabled}`);
      }
      
      // Click Начать сбор
      const startBtn = page.locator('button:has-text("Начать сбор")').first();
      if (await startBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await startBtn.click();
        log('trends', 'Collection started', 'pass');
        
        // Wait for completion
        await page.waitForTimeout(45000);
        await page.reload();
        await page.waitForTimeout(3000);
        
        const afterText = await page.textContent('body');
        const hasSources = afterText.includes('Все источники') || afterText.includes('Снять выбор');
        log('trends', `After collection — sources present: ${hasSources}`, hasSources ? 'pass' : 'warn');
        
        if (!hasSources) {
          bug('trends', 'After collecting sources, none appear on page');
        }
        
        await ss(page, '09-after-collect');
        
        // Select all sources
        const selectAll = page.locator('button:has-text("Выбрать все")').first();
        if (await selectAll.isVisible({ timeout: 2000 }).catch(() => false)) {
          await selectAll.click();
          await page.waitForTimeout(1000);
          log('trends', 'Selected all sources', 'pass');
          
          // Now "Собрать тренды" should appear
          const collectTrends = page.locator('button:has-text("Собрать тренды")').first();
          if (await collectTrends.isVisible({ timeout: 3000 }).catch(() => false)) {
            log('trends', '"Собрать тренды" button visible after selection', 'pass');
            
            await collectTrends.click();
            log('trends', 'Trend collection started');
            await page.waitForTimeout(90000);
            
            await page.reload();
            await page.waitForTimeout(3000);
            
            const trendText = await page.textContent('body');
            const countMatch = trendText.match(/Всего трендов: (\d+)/);
            const trendCount = countMatch ? parseInt(countMatch[1]) : 0;
            log('trends', `Trends after collection: ${trendCount}`);
            
            if (trendCount === 0) {
              bug('trends', 'After collecting trends, count is still 0 — webhook may have failed to save');
            }
            
            await ss(page, '10-trends-collected');
            
            // Check individual trend items
            if (trendCount > 0) {
              // Try clicking on a trend
              const trendItem = page.locator('[class*="trend"], [data-testid*="trend"]').first();
              if (await trendItem.isVisible({ timeout: 2000 }).catch(() => false)) {
                await trendItem.click();
                await page.waitForTimeout(1500);
                await ss(page, '11-trend-detail');
                log('trends', 'Trend detail view opened', 'pass');
              }
            }
          } else {
            bug('trends', '"Собрать тренды" button not visible after selecting sources');
          }
        }
      }
    } else {
      bug('trends', 'Platform selection dialog did not open');
    }
  } else {
    bug('trends', '"Собрать источники" button not visible');
  }

  // ===== STEP 6: CONTENT PAGE =====
  log('content', '=== STEP 6: Content page ===');
  await page.goto('https://smm.omemo.tech/content');
  await page.waitForTimeout(3000);
  await dismissOverlays(page);
  
  // All tabs
  for (const tab of ['Все', 'Черновики', 'Запланированные', 'Опубликованные']) {
    const tabBtn = page.locator(`button:has-text("${tab}")`).first();
    if (await tabBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await tabBtn.click();
      await page.waitForTimeout(800);
      log('content', `Tab "${tab}"`, 'pass');
    }
  }
  await ss(page, '12-content');
  
  // Create content dialog
  const createContent = page.locator('button:has-text("Создать контент")').first();
  if (await createContent.isVisible({ timeout: 2000 }).catch(() => false)) {
    await createContent.click();
    await page.waitForTimeout(2000);
    await ss(page, '13-create-content-dialog');
    const dialog = page.locator('[role="dialog"]').first();
    const isOpen = await dialog.isVisible({ timeout: 1000 }).catch(() => false);
    log('content', `Create dialog open: ${isOpen}`, isOpen ? 'pass' : 'warn');
    if (isOpen) {
      const inputs = await page.locator('[role="dialog"] input, [role="dialog"] textarea, [role="dialog"] select').all();
      log('content', `  Form fields: ${inputs.length}`);
      await page.keyboard.press('Escape');
    }
  }

  // ===== STEP 7: SCHEDULED PAGE =====
  log('scheduled', '=== STEP 7: Scheduled page ===');
  await page.goto('https://smm.omemo.tech/publish/scheduled');
  await page.waitForTimeout(3000);
  await dismissOverlays(page);
  await ss(page, '14-scheduled');

  // ===== STEP 8: PUBLICATIONS PAGE =====
  log('publications', '=== STEP 8: Publications page ===');
  await page.goto('https://smm.omemo.tech/posts');
  await page.waitForTimeout(3000);
  await dismissOverlays(page);
  await ss(page, '15-publications');
  
  // Calendar interaction
  const dateBtn = page.locator('button:has-text("13"), button:has-text("22")').first();
  if (await dateBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await dateBtn.click();
    await page.waitForTimeout(1000);
    log('publications', 'Calendar date clicked', 'pass');
  }

  // ===== STEP 9: ANALYTICS PAGE =====
  log('analytics', '=== STEP 9: Analytics page ===');
  await page.goto('https://smm.omemo.tech/analytics');
  await page.waitForTimeout(3000);
  await dismissOverlays(page);
  await ss(page, '16-analytics');
  
  // Check verdict
  const bodyText = await page.textContent('body');
  const hasVerdict = bodyText.includes('Нет данных') || bodyText.includes('Недостаточно') || bodyText.includes('эффективност');
  log('analytics', `Verdict displayed: ${hasVerdict}`, hasVerdict ? 'pass' : 'warn');
  
  // Period selector
  const period = page.locator('select, [role="combobox"]').first();
  if (await period.isVisible({ timeout: 2000 }).catch(() => false)) {
    await period.click();
    await page.waitForTimeout(500);
    await ss(page, '17-analytics-period');
    await page.keyboard.press('Escape');
  }

  // ===== STEP 10: MOBILE CHECKS =====
  log('responsive', '=== STEP 10: Mobile viewport ===');
  await page.setViewportSize({ width: 375, height: 812 });
  for (const [name, url] of [
    ['content-mobile', '/content'],
    ['analytics-mobile', '/analytics'],
    ['trends-mobile', '/trends'],
  ]) {
    await page.goto(`https://smm.omemo.tech${url}`);
    await page.waitForTimeout(2000);
    await dismissOverlays(page);
    await ss(page, `18-${name}`);
    log('responsive', `${name}: loaded`, 'pass');
  }

  // ===== SUMMARY =====
  console.log('\n=== FINDINGS SUMMARY ===');
  console.log(`Total checks: ${findings.length}`);
  console.log(`Pass: ${findings.filter(f => f.severity === 'pass').length}`);
  console.log(`Warn: ${findings.filter(f => f.severity === 'warn').length}`);
  console.log(`Fail: ${findings.filter(f => f.severity === 'fail').length}`);
  
  console.log(`\n=== BUGS FOUND: ${BUGS.length} ===`);
  BUGS.forEach((b, i) => console.log(`  ${i+1}. [${b.impact}] ${b.category}: ${b.message}`));
  
  // Save reports
  const md = `# Full UI Test Report — ${new Date().toISOString()}\n\n` +
    `## Summary\n` +
    `- Total checks: ${findings.length}\n` +
    `- Pass: ${findings.filter(f => f.severity === 'pass').length}\n` +
    `- Warn: ${findings.filter(f => f.severity === 'warn').length}\n` +
    `- Fail: ${findings.filter(f => f.severity === 'fail').length}\n\n` +
    `## Bugs Found: ${BUGS.length}\n\n` +
    BUGS.map((b, i) => `### Bug ${i+1} [${b.impact}]\n- **Category:** ${b.category}\n- **Description:** ${b.message}\n`).join('\n') +
    `## Detailed Findings\n\n` +
    `| Severity | Category | Message |\n|---|---|---|\n` +
    findings.map(f => `| ${f.severity.toUpperCase()} | ${f.category} | ${f.message} |`).join('\n');

  fs.writeFileSync(`${DIR}/full-report.md`, md);
  fs.writeFileSync(`${DIR}/findings.json`, JSON.stringify(findings, null, 2));
  fs.writeFileSync(`${DIR}/bugs.json`, JSON.stringify(BUGS, null, 2));

  await browser.close();
})();
