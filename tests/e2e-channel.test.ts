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
async function loadConfig(
  specifier: '../playwright.config' | '../playwright.perf.config',
  channel?: string,
): Promise<PlaywrightConfigShape> {
  vi.resetModules();
  if (channel === undefined) delete process.env.PW_CHANNEL;
  else process.env.PW_CHANNEL = channel;
  return (await import(specifier)).default as PlaywrightConfigShape;
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
    const config = await loadConfig('../playwright.config', value);
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

/**
 * Нагрузочный набор Q02 идёт тем же браузером: `channel: 'chrome'` в его конфиге
 * означал, что `npm run test:perf` на машине без системного Chrome не стартует,
 * хотя README обещает одну команду установки (D-142).
 */
describe('браузер нагрузочного набора', SLOW_IMPORT, () => {
  async function perfChannelOf(value?: string): Promise<string | undefined> {
    const config = await loadConfig('../playwright.perf.config', value);
    expect(config.projects).toHaveLength(1);
    const [project] = config.projects;
    // Имя проекта — то, что печатает reporter: «chrome» при бандловом Chromium
    // сделал бы протокол замера неправдой.
    expect(project?.name).toBe('chromium');
    return project?.use.channel;
  }

  test('без PW_CHANNEL нагрузочный набор идёт на бандловом Chromium', async () => {
    expect(await perfChannelOf()).toBeUndefined();
  });

  test('PW_CHANNEL=chrome переносится и на нагрузочный набор', async () => {
    expect(await perfChannelOf('chrome')).toBe('chrome');
  });

  test('пустое значение — это отсутствие канала, как и в наборе e2e', async () => {
    expect(await perfChannelOf('  ')).toBeUndefined();
  });
});

describe('спеки и скрипты не требуют браузера сверх README', () => {
  const dir = join(process.cwd(), 'tests/e2e');
  const files = [
    ...readdirSync(dir).map((name) => join('tests/e2e', name)),
    'tests/perf/editor.spec.ts',
    // Пересъёмка снимков презентации — тот же случай: свой `channel` здесь
    // требовал системный Chrome в обход единственной переменной.
    'scripts/capture-presentation.ts',
  ].filter((name) => name.endsWith('.ts'));

  test.each(files)('%s не задаёт канал браузера сам', (name) => {
    const source = readFileSync(join(process.cwd(), name), 'utf8');
    // Канал выбирается одной переменной окружения в playwright.config.ts:
    // файл с собственным `channel` снова сломал бы прогон по README.
    expect(source).not.toMatch(/channel:\s*['"]/);
  });
});
