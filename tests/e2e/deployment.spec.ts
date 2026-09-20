/**
 * I01: проверка развёрнутого сервиса, а не dev-сборки.
 *
 * Эти тесты идут не по `npm run dev`, а по адресу уже поднятого контейнера из
 * переменной `DEPLOY_URL`. Там один процесс отдаёт и собранный SPA, и `/api`,
 * поэтому проверяется именно то, что увидит проверяющий: health, открытие
 * редактора по прямой ссылке, ассистент без ключа провайдера и путь «открыть
 * план → сохранить».
 *
 * Адреса по умолчанию здесь намеренно нет. С умолчанием
 * http://127.0.0.1:8080 обычный `npm run test:e2e` цеплялся к любому процессу,
 * который случайно слушает этот порт (`npm run serve` из README — тот же порт),
 * и проверял деплой по dev-сборке: без собранного `dist/` прогон давал три
 * падения на ровном месте. Поэтому правило простое: переменной нет — деплой
 * никто не просил проверять, тесты пропускаются с причиной и сеть не трогается;
 * переменная задана — проверяют конкретный деплой, и недоступный адрес обязан
 * падать, а не молча пропускаться. Команда запуска — в docs/deployment.md.
 *
 * Контейнер для этой проверки поднимается БЕЗ ключа LLM (`.env` без `LLM_*`),
 * поэтому ассистент обязан ответить расчётом с пометкой «Без LLM»: этот режим
 * обязателен по D-016 и его же увидит жюри, если ключ кончился.
 */

import { readFileSync } from 'node:fs';
import { expect, test, type Page } from './fixtures';

/** Пусто — адрес деплоя не назвали, проверять нечего. */
const DEPLOY_URL = (process.env.DEPLOY_URL ?? '').trim().replace(/\/+$/, '');

const SKIP_REASON =
  'DEPLOY_URL не задан: эти тесты идут по адресу развёрнутого сервиса. Поднимите его ' +
  '`docker compose up --build -d` и запустите с `DEPLOY_URL=http://127.0.0.1:8080` ' +
  '(docs/deployment.md)';

/** Один короткий запрос: живой сервис отвечает быстро, мёртвый не задерживает прогон. */
async function serviceIsUp(): Promise<boolean> {
  try {
    const response = await fetch(`${DEPLOY_URL}/api/health`, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function clickCanvas(page: Page, x: number, y: number): Promise<void> {
  await page.getByTestId('editor-canvas').click({ position: { x, y } });
}

async function drawZone(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Зона', exact: true }).click();
  await clickCanvas(page, 200, 180);
  await clickCanvas(page, 430, 180);
  await clickCanvas(page, 430, 360);
  await clickCanvas(page, 200, 360);
  await clickCanvas(page, 200, 180);
  await page.getByRole('button', { name: 'Выбор', exact: true }).click();
}

test.describe('развёрнутый сервис', () => {
  // Без адреса деплоя baseURL не подменяется: тесты всё равно не дойдут до goto.
  test.use({ baseURL: DEPLOY_URL || undefined });

  test.beforeEach(async () => {
    test.skip(DEPLOY_URL.length === 0, SKIP_REASON);
    if (!(await serviceIsUp())) {
      throw new Error(`сервис по DEPLOY_URL=${DEPLOY_URL} не отвечает на /api/health`);
    }
  });

  test('health отвечает ok', async ({ request }) => {
    const response = await request.get(`${DEPLOY_URL}/api/health`);
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { status: string; llm: { configured: boolean } };
    expect(body.status).toBe('ok');
    // Режим ассистента виден по адресу сервиса: с ключом на сервере — true.
    expect(typeof body.llm.configured).toBe('boolean');
  });

  test('SPA отдаётся с того же адреса, включая прямую ссылку', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    const opened = await page.goto('/');
    expect(opened?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Цифровой двойник ОПС' })).toBeVisible();
    await expect(page.locator('canvas').first()).toBeVisible();

    // Собранная сборка, а не dev: в проде Vite не вставляет свой клиент.
    expect(await page.content()).not.toContain('/@vite/client');

    // Прямая ссылка на внутренний путь — не 404: SPA-маршрутизация в браузере.
    const deep = await page.goto('/plan/demo');
    expect(deep?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Цифровой двойник ОПС' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('несуществующий метод API отвечает 404, а не страницей', async ({ request }) => {
    const response = await request.get(`${DEPLOY_URL}/api/nothing-here`);
    expect(response.status()).toBe(404);
    expect(response.headers()['content-type']).toContain('application/json');
  });

  test('ассистент отвечает: с ключом — объяснение модели, без ключа — расчёт с пометкой «без LLM»', async ({
    page,
  }) => {
    await page.goto('/');
    await drawZone(page);

    const panel = page.getByLabel('Ассистент');
    await panel.getByRole('button', { name: 'Спросить' }).click();

    // Ответ пришёл с сервера: mode=llm, если на сервере задан ключ провайдера,
    // иначе mode=fallback с пометкой. Оба — рабочие режимы, пустой экран — дефект.
    await expect(panel.locator('.assistant__mode')).toContainText(
      /Без LLM|Объяснение модели проверено расчётом/,
    );
    await expect(panel.locator('.advice__sentence')).toContainText('Место найдено');
    await expect(panel.locator('.advice__candidates li').first()).toContainText('Свободно:');
  });

  test('план открывается и сохраняется на развёрнутом сервисе', async ({ page }) => {
    await page.goto('/');

    const fixture = readFileSync('src/contracts/fixtures/minimal.json', 'utf8');
    await page.getByTestId('plan-file-input').setInputFiles({
      name: 'minimal.json',
      mimeType: 'application/json',
      buffer: Buffer.from(fixture, 'utf8'),
    });

    // В перечне зона видна по идентификатору, объект — по подписи из файла.
    await expect(page.locator('.table__link', { hasText: 'z_client' }).first()).toBeVisible();
    await expect(
      page.getByLabel('Инвентаризация').locator('.table__link', { hasText: 'Рабочее место 1' }),
    ).toBeVisible();

    const download = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Сохранить' }).click(),
    ]).then(([event]) => event);

    const saved = await download.path();
    expect(saved).not.toBeNull();
    const parsed = JSON.parse(readFileSync(saved as string, 'utf8')) as {
      zones: { id: string }[];
      objects: { id: string }[];
    };
    expect(parsed.zones.map((zone) => zone.id)).toContain('z_client');
    expect(parsed.objects.map((object) => object.id)).toContain('eq_work_1');
    await expect(page.getByText('сохранено')).toBeVisible();
  });
});
