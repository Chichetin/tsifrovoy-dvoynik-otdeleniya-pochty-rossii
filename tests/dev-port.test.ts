/**
 * Порт dev-сервера — один для Vite и Playwright, берётся из `DEV_PORT`.
 *
 * Зачем тест на конфигурацию: два worktree одновременно гоняли e2e на 5173 и
 * тестировали чужую сборку (блокер U03). Проверяется наблюдаемое поведение —
 * что читают конфиги при разных значениях переменной, а не их текст.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';

type ViteConfigShape = { server: { port: number; strictPort: boolean; host: string } };
type PlaywrightConfigShape = {
  use: { baseURL: string };
  webServer: { url: string; command: string; reuseExistingServer: boolean };
};

const ENV_KEYS = ['DEV_PORT', 'PW_REUSE_SERVER', 'CI'] as const;

/** Значения, с которыми запущен сам прогон: после теста они возвращаются на место. */
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

/** Конфиги читают process.env на импорте, поэтому каждый вызов — свежий модуль. */
async function load<T>(path: string, env: Partial<Record<(typeof ENV_KEYS)[number], string>>): Promise<T> {
  vi.resetModules();
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  return (await import(path)).default as T;
}

const loadVite = (env: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}) =>
  load<ViteConfigShape>('../vite.config', env);
const loadPlaywright = (env: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}) =>
  load<PlaywrightConfigShape>('../playwright.config', env);

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = ORIGINAL_ENV[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

/**
 * Запас по времени: первый импорт `@playwright/test` вместе с конфигом Vite
 * в общем прогоне (28 файлов, jsdom на каждый) занимает секунды — это цена
 * импорта, а не проверяемое поведение.
 */
const SLOW_IMPORT = { timeout: 30_000 };

describe('DEV_PORT: порт dev-сервера', SLOW_IMPORT, () => {
  test('без переменной оба конфига работают на 5173', async () => {
    const vite = await loadVite();
    const playwright = await loadPlaywright();

    expect(vite.server.port).toBe(5173);
    expect(vite.server.strictPort).toBe(true);
    expect(playwright.use.baseURL).toBe('http://127.0.0.1:5173');
    expect(playwright.webServer.url).toBe('http://127.0.0.1:5173');
  });

  test('DEV_PORT=5174 переносит на 5174 и адрес проверки, и команду запуска', async () => {
    const vite = await loadVite({ DEV_PORT: '5174' });
    const playwright = await loadPlaywright({ DEV_PORT: '5174' });

    expect(vite.server.port).toBe(5174);
    expect(playwright.use.baseURL).toBe('http://127.0.0.1:5174');
    expect(playwright.webServer.url).toBe('http://127.0.0.1:5174');
    // Порт уходит в дочерний процесс явно: в списке процессов видно, чей это сервер.
    expect(playwright.webServer.command).toContain('--port 5174');
    expect(playwright.webServer.command).toContain('--strictPort');
  });

  test('адрес — 127.0.0.1, а не localhost (D-035)', async () => {
    const playwright = await loadPlaywright({ DEV_PORT: '5199' });
    expect(playwright.use.baseURL).not.toContain('localhost');
    expect(playwright.use.baseURL).toBe('http://127.0.0.1:5199');
  });

  test.each(['0', '-1', '70000', 'abc', '5173.5', ''])(
    'непригодное значение %j останавливает запуск, а не молча даёт 5173',
    async (value) => {
      await expect(loadVite({ DEV_PORT: value })).rejects.toThrow('DEV_PORT');
      await expect(loadPlaywright({ DEV_PORT: value })).rejects.toThrow('DEV_PORT');
    },
  );
});

describe('чужой dev-сервер не переиспользуется молча', SLOW_IMPORT, () => {
  test('по умолчанию Playwright поднимает свой сервер', async () => {
    const playwright = await loadPlaywright();
    expect(playwright.webServer.reuseExistingServer).toBe(false);
  });

  test('CI не включает переиспользование', async () => {
    const playwright = await loadPlaywright({ CI: '1' });
    expect(playwright.webServer.reuseExistingServer).toBe(false);
  });

  test('PW_REUSE_SERVER=1 — явное разрешение для ручной отладки', async () => {
    const playwright = await loadPlaywright({ PW_REUSE_SERVER: '1' });
    expect(playwright.webServer.reuseExistingServer).toBe(true);
  });

  test('PW_REUSE_SERVER=0 не считается разрешением', async () => {
    const playwright = await loadPlaywright({ PW_REUSE_SERVER: '0' });
    expect(playwright.webServer.reuseExistingServer).toBe(false);
  });
});
