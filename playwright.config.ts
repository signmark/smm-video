import { defineConfig, devices } from '@playwright/test';
import fs from 'fs';

const NIX_CHROMIUM = '/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium';
const systemChromium = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  || (fs.existsSync(NIX_CHROMIUM) ? NIX_CHROMIUM : undefined);

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : (process.env.PLAYWRIGHT_WORKERS ? parseInt(process.env.PLAYWRIGHT_WORKERS) : 3),
  reporter: 'html',
  timeout: process.env.PLAYWRIGHT_TIMEOUT ? parseInt(process.env.PLAYWRIGHT_TIMEOUT) : 30000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 10000,
    navigationTimeout: 30000,
  },

  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
      use: {
        ...(systemChromium ? { launchOptions: { executablePath: systemChromium } } : {}),
      },
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/user.json',
        ...(systemChromium ? { launchOptions: { executablePath: systemChromium } } : {}),
      },
      dependencies: ['setup'],
    },
  ],

  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:5000',
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
        env: { PORT: '5000' },
      },
});
