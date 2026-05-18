import { test as base } from '@playwright/test';
import type { Page } from '@playwright/test';

export const SP_INIT_SCRIPT = `(function () {
  var removeSP = function () {
    try {
      ['sp-overlay', 'sp-cc', 'sp-banner', 'sp-policy-bar', 'sp-content-wrapper'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.remove();
      });
      document.querySelectorAll('[id^="sp-"]').forEach(function (el) { el.remove(); });
      if (document.body) document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    } catch (e) {}
  };

  removeSP();

  var startObserver = function () {
    try {
      new MutationObserver(removeSP).observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { startObserver(); removeSP(); });
  } else {
    startObserver();
  }

  window.addEventListener('load', removeSP);
})();`;

export async function setupNoSecurePrivacy(page: Page): Promise<void> {
  await page.route(/secureprivacy\.ai/, (route) => route.abort());
  await page.addInitScript(SP_INIT_SCRIPT);
}

export const test = base.extend<{}>({
  page: async ({ page }, use) => {
    await setupNoSecurePrivacy(page);
    await use(page);
  },
});

export { expect } from '@playwright/test';
export type { Page, Browser, BrowserContext } from '@playwright/test';
