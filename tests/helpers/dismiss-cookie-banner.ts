import { Page } from '@playwright/test';

/**
 * Блокирует Secure Privacy скрипт и удаляет оверлей (#sp-overlay) через JS.
 * Устанавливает MutationObserver чтобы overlay не появлялся повторно.
 * Вызывать ДО page.goto (для route blocking) и ПОСЛЕ (для JS cleanup).
 */
export async function blockSecurePrivacy(page: Page): Promise<void> {
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

/**
 * Удаляет оверлей Secure Privacy (#sp-overlay) через JavaScript.
 * Используется как резервный метод после page.goto.
 */
export async function dismissCookieBanner(page: Page): Promise<void> {
  try {
    await page.evaluate(() => {
      ['sp-overlay', 'sp-cc', 'sp-banner', 'sp-policy-bar', 'sp-content-wrapper'].forEach((id) => {
        document.getElementById(id)?.remove();
      });
      document.querySelectorAll('[id^="sp-"]').forEach((el) => el.remove());
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    });
  } catch {
  }
}
