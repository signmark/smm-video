import { test as setup, expect } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const authDir = path.join(__dirname, '../playwright/.auth');
const authFile = path.join(authDir, 'user.json');

async function blockAndKillSecurePrivacy(page: import('@playwright/test').Page) {
  await page.route(/secureprivacy\.ai/, (route) => route.abort());

  await page.addInitScript(() => {
    const removeSP = () => {
      try {
        ['sp-overlay', 'sp-cc', 'sp-banner', 'sp-policy-bar', 'sp-content-wrapper'].forEach((id) => {
          document.getElementById(id)?.remove();
        });
        document.querySelectorAll('[id^="sp-"]').forEach((el) => el.remove());
        if (document.body) document.body.style.overflow = '';
        document.documentElement.style.overflow = '';
      } catch {}
    };
    removeSP();
    const startObserver = () => {
      try {
        new MutationObserver(removeSP).observe(document.documentElement, { childList: true, subtree: true });
      } catch {}
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => { startObserver(); removeSP(); });
    } else {
      startObserver();
    }
    window.addEventListener('load', removeSP);
  });
}

async function killSecurePrivacyOverlay(page: import('@playwright/test').Page) {
  try {
    await page.evaluate(() => {
      ['sp-overlay', 'sp-cc', 'sp-banner', 'sp-policy-bar'].forEach((id) => {
        document.getElementById(id)?.remove();
      });
      document.querySelectorAll('[id^="sp-"]').forEach((el) => el.remove());
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    });
    console.log('Secure Privacy overlay removed via JS');
  } catch {}
}

setup('authenticate', async ({ page }) => {
  setup.setTimeout(60000);

  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  const email = process.env.TEST_EMAIL || process.env.ADMIN_EMAIL || process.env.DIRECTUS_ADMIN_EMAIL || 'lbrspb@gmail.com';
  const password = process.env.TEST_PASSWORD || process.env.ADMIN_PASSWORD || process.env.DIRECTUS_ADMIN_PASSWORD || 'QtpZ3dh7';

  console.log(`Authenticating with ${email}...`);

  // 1. Block SP script at network level + install MutationObserver BEFORE goto
  await blockAndKillSecurePrivacy(page);

  // 2. Navigate to login
  await page.goto('/auth/login');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

  // 3. Kill any remaining SP overlay via JS
  await killSecurePrivacyOverlay(page);

  // 4. Fill credentials
  const emailInput = page.getByPlaceholder(/email/i).or(page.locator('input[name="email"]'));
  const passwordInput = page.getByPlaceholder(/пароль/i).or(page.locator('input[name="password"]'));
  await expect(emailInput).toBeVisible({ timeout: 10000 });
  await expect(passwordInput).toBeVisible({ timeout: 10000 });
  await emailInput.fill(email);
  await passwordInput.fill(password);

  // 5. Kill overlay again just before clicking
  await killSecurePrivacyOverlay(page);

  // 6. Submit
  await page.getByRole('button', { name: /войти/i }).click();

  // 7. Wait for campaigns page
  await page.waitForURL('**/campaigns**', { timeout: 30000 });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);

  // 8. Kill overlay on campaigns page
  await killSecurePrivacyOverlay(page);

  // 9. Clear smm_new_user so WelcomeDialog never blocks tests
  await page.evaluate(() => {
    localStorage.removeItem('smm_new_user');
  });

  // 10. Save storage state (localStorage + cookies)
  await page.context().storageState({ path: authFile });
  console.log('Auth state saved to', authFile);
});
