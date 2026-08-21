/**
 * AI-86 browser evidence — final version.
 */
import { chromium } from '/root/smm/node_modules/playwright/index.mjs';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://127.0.0.1:5101';
const OUT_DIR = '/root/smm-worktrees/ai86-v2/ai86-evidence-screenshots';

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function fakeJwt() {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'u-1', exp: Math.floor(Date.now() / 1000) + 86400, iat: Math.floor(Date.now() / 1000),
    id: 'u-1', email: 'browser@example.com', role: 'user'
  })).toString('base64url');
  return `${header}.${payload}.mock`;
}

async function capture(context, urlPath, label) {
  console.log(`\n=== ${label} — ${urlPath} ===`);
  const page = await context.newPage();
  await page.goto(`${BASE_URL}${urlPath}`, { waitUntil: 'load' });

  // Wait for shell to render (auth check passed)
  await page.waitForFunction(() => {
    const root = document.getElementById('root');
    return root && root.innerHTML.length > 5000;
  }, { timeout: 5000 });
  await new Promise(r => setTimeout(r, 100)); // small tick for React

  // T+0: screenshot during 5s pending
  const t0Path = path.join(OUT_DIR, `${label}-T0-loading.png`);
  await page.screenshot({ path: t0Path, fullPage: false });

  const t0Dom = await page.evaluate(() => ({
    h1: document.querySelector('h1')?.textContent?.trim() || null,
    scheduledUpcoming: document.querySelector('[data-testid="scheduled-upcoming-count"]')?.textContent || null,
    scheduledAll: document.querySelector('[data-testid="scheduled-all-count"]')?.textContent || null,
    trendsPlaceholder: !!document.querySelector('[data-testid="trends-loading-placeholder"]'),
    createBtn: !!document.querySelector('[data-testid="button-open-create-campaign-dialog"]'),
    campaignsPlaceholder: !!document.querySelector('[data-testid="campaigns-loading-placeholder"]'),
    search: !!document.querySelector('[data-testid="input-search-campaigns"]'),
    fullPageLoader: !!document.querySelector('div.flex.justify-center.p-8 > .h-8.w-8.animate-spin'),
    anyPulse: !!document.querySelector('.animate-pulse'),
    anySpin: !!document.querySelector('.animate-spin'),
  }));
  console.log('T+0 (loading):', JSON.stringify(t0Dom));

  // Wait for 5s+slack
  await new Promise(r => setTimeout(r, 5500));

  const t1Path = path.join(OUT_DIR, `${label}-T1-settled.png`);
  await page.screenshot({ path: t1Path, fullPage: false });

  const t1Dom = await page.evaluate(() => ({
    h1: document.querySelector('h1')?.textContent?.trim() || null,
    scheduledUpcoming: document.querySelector('[data-testid="scheduled-upcoming-count"]')?.textContent || null,
    scheduledAll: document.querySelector('[data-testid="scheduled-all-count"]')?.textContent || null,
    trendsPlaceholder: !!document.querySelector('[data-testid="trends-loading-placeholder"]'),
    createBtn: !!document.querySelector('[data-testid="button-open-create-campaign-dialog"]'),
    campaignsPlaceholder: !!document.querySelector('[data-testid="campaigns-loading-placeholder"]'),
    search: !!document.querySelector('[data-testid="input-search-campaigns"]'),
  }));
  console.log('T+5.5s (settled):', JSON.stringify(t1Dom));

  await page.close();
  return { t0Dom, t1Dom, t0Path, t1Path };
}

(async () => {
  const token = fakeJwt();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript((tok) => {
    window.localStorage.setItem('auth_token', tok);
    window.localStorage.setItem('refresh_token', tok);
    window.localStorage.setItem('user_id', 'u-1');
    window.localStorage.setItem('user_email', 'browser@example.com');
    window.localStorage.setItem('is_admin', 'true');
    // campaign-storage persist key (zustand) — needed for scheduled query to fire
    window.localStorage.setItem('campaign-storage', JSON.stringify({
      state: { selectedCampaign: { id: 'camp-1', name: 'Camp 1' }, selectedCampaignId: 'camp-1', selectedCampaignName: 'Camp 1' },
      version: 0,
    }));
    window.localStorage.setItem('selected_campaign_id', 'camp-1');
    window.localStorage.setItem('selected_campaign_name', 'Camp 1');
  }, token);

  const results = {};
  try {
    results.scheduled = await capture(context, '/publish/scheduled', 'scheduled');
    results.trends = await capture(context, '/trends', 'trends');
    results.campaigns = await capture(context, '/campaigns', 'campaigns');
  } finally {
    await browser.close();
  }

  console.log('\n\n=== SUMMARY ===');
  console.log(JSON.stringify(results, null, 2));
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });