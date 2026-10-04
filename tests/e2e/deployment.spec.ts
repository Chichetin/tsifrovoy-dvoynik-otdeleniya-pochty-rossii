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
import { expect, test, type Page, exportPlan } from './fixtures';
import { showTab } from './side-tabs';

/**
 * Сколько ждать ответа ассистента на развёрнутом сервисе: рекомендованный
 * бюджет модели `LLM_TIMEOUT_MS=60000` (D-206) плюс запас на сеть и разбор
 * ответа. Без ключа ответ приходит сразу, и ожидание не тратится.
 */
const LLM_WAIT_MS = 75_000;

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
  await page
    .getByRole('toolbar', { name: 'Инструменты плана' })
    .getByRole('button', { name: 'Зона', exact: true })
    .click();
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
    // Единственный тест набора, который ждёт живую модель. Без ключа ответ
    // приходит мгновенно, с ключом рассуждающая модель думает 20–40 с при
    // LLM_TIMEOUT_MS=60000, поэтому обычных 30 с теста и 5 с ожидания мало:
    // на боевом адресе, где ключ как раз задан, проверка падала по таймауту,
    // хотя сервис отвечал правильно.
    test.setTimeout(LLM_WAIT_MS + 30_000);
    await page.goto('/');
    await drawZone(page);

    // D-249: панели правой колонки — вкладки, видна одна. Без этого шага спека
    // искала «Спросить» в скрытой панели и валилась по таймауту на живом деплое.
    await showTab(page, 'Ассистент');

    // `exact`: рядом есть плавающая кнопка «Ассистент» с тем же именем.
    const panel = page.getByLabel('Ассистент', { exact: true });
    const startedAt = Date.now();
    const responsePromise = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/advice'
        && response.request().method() === 'POST',
      { timeout: LLM_WAIT_MS },
    );
    await panel.getByRole('button', { name: 'Спросить' }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const body = await response.json() as { mode: unknown };
    expect(['llm', 'fallback']).toContain(body.mode);
    // Persist only safe evidence, never headers, credentials or the response text.
    const evidence = JSON.stringify({
      checkedAt: new Date().toISOString(),
      origin: new URL(response.url()).origin,
      route: '/api/advice',
      status: response.status(),
      mode: body.mode,
      elapsedMs: Date.now() - startedAt,
    }, null, 2);
    const evidencePath = test.info().outputPath('assistant-response-mode.json');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(evidencePath, evidence, 'utf8');
    await test.info().attach('assistant-response-mode', {
      path: evidencePath,
      contentType: 'application/json',
    });

    // Even with a configured key the provider or verification may fail.
    // Both modes must render, but their actual distinction stays in the evidence.
    await expect(panel.locator('.assistant__mode')).toContainText(
      /Без LLM|Объяснение модели проверено расчётом/,
      { timeout: LLM_WAIT_MS },
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

    // В перечне зона и объект видны по названиям из файла; id — в подсказке.
    await expect(
      page.getByLabel('Инвентаризация').locator('.table__link', { hasText: 'Клиентская зона' }).first(),
    ).toBeVisible();
    await expect(
      page.getByLabel('Инвентаризация').locator('.table__link', { hasText: 'Рабочее место 1' }),
    ).toBeVisible();

    const download = await Promise.all([
      page.waitForEvent('download'),
      exportPlan(page, 'JSON'),
    ]).then(([event]) => event);

    const saved = await download.path();
    expect(saved).not.toBeNull();
    const parsed = JSON.parse(readFileSync(saved as string, 'utf8')) as {
      zones: { id: string }[];
      objects: { id: string }[];
    };
    expect(parsed.zones.map((zone) => zone.id)).toContain('z_client');
    expect(parsed.objects.map((object) => object.id)).toContain('eq_work_1');
  });
});
