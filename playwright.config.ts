import { defineConfig, devices } from '@playwright/test';
import { resolveDevPort } from './vite.config';

// Тот же порт, что у Vite (D-095): адрес проверки, baseURL и команда запуска
// считаются из одной переменной DEV_PORT.
const devPort = resolveDevPort(process.env.DEV_PORT);
const baseURL = `http://127.0.0.1:${devPort}`;

/**
 * Браузер по умолчанию — бандловый Chromium, который ставит команда README
 * `npx playwright install chromium` (D-125). Системный Google Chrome в наборе
 * не требуется: `playwright install chrome` работает не на каждом Linux, а
 * сценариям набора (скачивание файла, открытие файла, localStorage) канал не
 * нужен. Проверить на системном Chrome можно явно: `PW_CHANNEL=chrome`.
 */
export function resolveChannel(raw: string | undefined): string | undefined {
  const value = raw?.trim() ?? '';
  return value === '' ? undefined : value;
}

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: resolveChannel(process.env.PW_CHANNEL) },
    },
  ],
  webServer: {
    // Порт передан и переменной, и флагом: в списке процессов видно, чей это сервер.
    command: `npm run dev -- --port ${devPort} --strictPort`,
    timeout: 180_000,
    url: baseURL,
    // По умолчанию свой сервер, а не чужой: раньше второй worktree молча гонял
    // спеки по сборке первого (D-096). Переиспользование — только явным
    // PW_REUSE_SERVER=1 при ручной отладке.
    reuseExistingServer: process.env.PW_REUSE_SERVER === '1',
  },
});
