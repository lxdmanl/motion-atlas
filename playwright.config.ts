import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['**/tests/**/*.spec.ts', '**/app/**/*.browser.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: 'output/playwright/artifacts',
  reporter: [['list'], ['html', { outputFolder: 'output/playwright/report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:3016',
    channel: 'chrome',
    viewport: { width: 1366, height: 768 },
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3016',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
