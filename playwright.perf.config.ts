import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.DEV_PORT ?? '5187');
export default defineConfig({
  testDir: 'tests/perf',
  timeout: 600_000,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'off' },
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
  webServer: {
    command: `node node_modules/vite/bin/vite.js --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    timeout: 180_000,
    // For debugging an explicitly started local server, set PW_REUSE_SERVER=1.
    reuseExistingServer: process.env.PW_REUSE_SERVER === '1',
  },
});
