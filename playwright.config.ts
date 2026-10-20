import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: 'Data/verification/playwright',
  reporter: [['list'], ['json', { outputFile: 'Data/verification/e2e-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:5173/weathercas/', channel: process.env.CI ? 'chrome' : 'msedge',
    viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  workers: 1,
  webServer: { command: 'npm run dev -- --port 5173 --strictPort', url: 'http://127.0.0.1:5173/weathercas/', reuseExistingServer: !process.env.CI },
});
