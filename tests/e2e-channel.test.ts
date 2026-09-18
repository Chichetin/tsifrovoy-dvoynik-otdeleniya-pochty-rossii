/**
 * Браузер набора e2e — тот, который ставит команда README.
 *
 * Зачем тест на конфигурацию: три спеки жёстко требовали системный Google
 * Chrome (`test.use({ channel: 'chrome' })`), а README обещает
 * `npx playwright install chromium`. На машине без Chrome прогон по README
 * падал ещё до открытия страницы (D-125). Проверяется наблюдаемое поведение —
 * какой канал получает проект Playwright при разных значениях `PW_CHANNEL`,
 * и что ни одна спека не возвращает жёсткий канал обратно.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

type PlaywrightConfigShape = {
  projects: { name: string; use: { channel?: string } }[];
};

const ORIGINAL = process.env.PW_CHANNEL;

/** Конфиг читает process.env на импорте, поэтому каждый вызов — свежий модуль. */
async function loadPlaywright(channel?: string): Promise<PlaywrightConfigShape> {
  vi.resetModules();
  if (channel === undefined) delete process.env.PW_CHANNEL;
  else process.env.PW_CHANNEL = channel;
  return (await import('../playwright.config')).default as PlaywrightConfigShape;
}

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.PW_CHANNEL;
  else process.env.PW_CHANNEL = ORIGINAL;
});

/** Первый импорт `@playwright/test` в общем прогоне занимает секунды. */
const SLOW_IMPORT = { timeout: 30_000 };

describe('браузер набора e2e', SLOW_IMPORT, () => {
  /** Канал единственного проекта конфига при заданном значении переменной. */
  async function channelOf(value?: string): Promise<string | undefined> {
    const config = await loadPlaywright(value);
    expect(config.projects).toHaveLength(1);
    const [project] = config.projects;
    expect(project?.name).toBe('chromium');
    return project?.use.channel;
  }

  test('без PW_CHANNEL канал не задан: идёт бандловый Chromium из README', async () => {
    expect(await channelOf()).toBeUndefined();
  });

  test('PW_CHANNEL=chrome запускает системный Chrome — для машины, где он есть', async () => {
    expect(await channelOf('chrome')).toBe('chrome');
  });

  test('PW_CHANNEL=msedge передаётся как есть, а не подменяется на chrome', async () => {
    expect(await channelOf('msedge')).toBe('msedge');
  });

  test.each(['', '   '])(
    'пустое значение %j — это отсутствие канала, а не канал с пустым именем',
    async (value) => {
      expect(await channelOf(value)).toBeUndefined();
    },
  );

  test('пробелы вокруг значения не превращаются в неизвестный канал', async () => {
    expect(await channelOf(' chrome ')).toBe('chrome');
  });
});

describe('спеки не требуют браузера сверх README', () => {
  const dir = join(process.cwd(), 'tests/e2e');

  test.each(readdirSync(dir).filter((name) => name.endsWith('.spec.ts')))(
    '%s не задаёт канал браузера сам',
    (name) => {
      const source = readFileSync(join(dir, name), 'utf8');
      // Канал выбирается одной переменной окружения в playwright.config.ts:
      // спека с собственным `channel` снова сломала бы прогон по README.
      expect(source).not.toMatch(/channel:\s*['"]/);
    },
  );
});
