import { defineConfig, devices } from '@playwright/test';
import { resolveChannel } from './playwright.config';

const port = Number(process.env.DEV_PORT ?? '5187');
export default defineConfig({
  testDir: 'tests/perf',
  timeout: 600_000,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'off' },
  // Тот же браузер, что у набора e2e (D-125): по умолчанию бандловый Chromium из
  // команды README `npx playwright install chromium`, системный Chrome —
  // `PW_CHANNEL=chrome npm run test:perf`. Опубликованный замер всё равно
  // называет браузер поимённо: спека кладёт в сырые данные его userAgent.
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: resolveChannel(process.env.PW_CHANNEL) },
    },
  ],
  webServer: {
    command: `node node_modules/vite/bin/vite.js --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    timeout: 180_000,
    // For debugging an explicitly started local server, set PW_REUSE_SERVER=1.
    reuseExistingServer: process.env.PW_REUSE_SERVER === '1',
  },
});
