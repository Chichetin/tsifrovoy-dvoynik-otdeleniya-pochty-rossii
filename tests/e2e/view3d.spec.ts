/**
 * D01 в браузере: 3D-вид строится из того же документа, что и 2D.
 *
 * Пиксели не читаем: рядом с canvas стоит список примитивов с data-атрибутами,
 * по нему и проверяем, что объект из 2D появился в 3D. Три группы: обычный запуск
 * (canvas или честное сообщение о WebGL — что есть, то и проверяется), запуск с
 * программным WebGL (SwiftShader — canvas обязан появиться) и запуск с выключенным
 * WebGL (сообщение обязано появиться, 2D остаётся рабочим).
 */

import { readFileSync } from 'node:fs';
import {
  expect,
  test,
  type Locator,
  type Page,
  type PlaywrightWorkerArgs,
  type PlaywrightWorkerOptions,
} from '@playwright/test';
import { encodePlan } from '../../src/persistence/codec';
import { importOrganizerExample } from '../../src/persistence/organizer-import';

const SWIFTSHADER_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const NO_WEBGL_ARGS = ['--disable-webgl', '--disable-3d-apis'];

type Launch = {
  playwright: PlaywrightWorkerArgs['playwright'];
  browserName: PlaywrightWorkerOptions['browserName'];
  baseURL?: string;
};

/**
 * Браузер с нужными флагами: `test.use({ launchOptions })` внутри describe
 * Playwright запрещает, поэтому запуск делается руками и закрывается всегда.
 */
async function withBrowser(
  { playwright, browserName, baseURL }: Launch,
  args: string[],
  run: (page: Page) => Promise<void>,
): Promise<void> {
  const browser = await playwright[browserName].launch({ args });
  try {
    const context = await browser.newContext(baseURL === undefined ? {} : { baseURL });
    await run(await context.newPage());
  } finally {
    await browser.close();
  }
}

async function clickCanvas(page: Page, x: number, y: number): Promise<void> {
  await page.getByTestId('editor-canvas').click({ position: { x, y } });
}

async function placeFirstLibraryItem(page: Page, x: number, y: number): Promise<string> {
  const item = page.locator('.library__item').first();
  const label = ((await item.locator('.library__label').textContent()) ?? '').trim();
  await item.click();
  await clickCanvas(page, x, y);
  await page.getByRole('button', { name: 'Выбор', exact: true }).click();
  return label;
}

const switchTo = (page: Page, view: '2D' | '3D') =>
  page.getByRole('group', { name: 'Вид плана' }).getByRole('button', { name: view, exact: true }).click();

/** Строки списка примитивов: сам `li` несёт data-kind и data-id. */
function prisms(page: Page, selector = ''): Locator {
  return page.getByTestId('view3d-primitives').locator(`li${selector}`);
}

/** Перечень объектов — первая таблица панели; дальше идут сводки по типам и зонам. */
const inventoryRows = (page: Page) =>
  page.getByLabel('Инвентаризация').locator('table').first().locator('tbody tr');

/**
 * Пример организаторов в нашем формате: редактор открывает только свой файл,
 * а сырой `example_plan.json` проходит через импорт (src/persistence).
 */
function examplePlanFile(): { name: string; mimeType: string; buffer: Buffer } {
  const raw: unknown = JSON.parse(readFileSync('example_plan.json', 'utf8'));
  const imported = importOrganizerExample(raw);
  if (!imported.ok) throw new Error(`example_plan.json не импортировался: ${JSON.stringify(imported.issues)}`);
  const encoded = encodePlan(imported.value);
  if (!encoded.ok) throw new Error(`план не закодировался: ${JSON.stringify(encoded.issues)}`);
  return { name: 'example_plan.ops.json', mimeType: 'application/json', buffer: Buffer.from(encoded.value) };
}

test.describe('3D-вид: обычный запуск', () => {
  test('объект из 2D появляется в списке примитивов 3D; 2D остаётся доступным', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');

    const placed = await placeFirstLibraryItem(page, 320, 240);
    await switchTo(page, '3D');
    await expect(page.getByTestId('view3d')).toBeVisible();
    await expect(page.getByText('Условные объёмы из текущего плана')).toBeVisible();

    // Объект, поставленный в 2D, — примитив с тем же id и подписью.
    const objects = prisms(page, '[data-kind="object"]');
    await expect(objects).toHaveCount(1);
    await expect(objects).toContainText(placed);
    expect(await objects.getAttribute('data-id')).toMatch(/^eq_/);

    // Что покажет этот браузер — canvas или сообщение о WebGL, — но что-то одно.
    const canvas = page.getByTestId('view3d-canvas');
    const unavailable = page.getByTestId('view3d-unavailable');
    await expect(canvas.or(unavailable)).toBeVisible();
    expect((await canvas.count()) + (await unavailable.count())).toBe(1);

    // Обратно в 2D: холст на месте, размещение работает, 3D больше не перекрывает.
    await switchTo(page, '2D');
    await expect(page.getByTestId('view3d')).toHaveCount(0);
    await placeFirstLibraryItem(page, 420, 300);
    await expect(inventoryRows(page)).toHaveCount(2);

    // И снова 3D: второй объект уже в сцене — состояние не хранится, сцена строится заново.
    await switchTo(page, '3D');
    await expect(objects).toHaveCount(2);
    expect(errors).toEqual([]);
  });
});

test.describe('3D-вид: программный WebGL (SwiftShader)', () => {
  test('canvas создан, выбранный объект подсвечен в списке', async ({ playwright, browserName, baseURL }) => {
    await withBrowser({ playwright, browserName, baseURL }, SWIFTSHADER_ARGS, async (page) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await placeFirstLibraryItem(page, 320, 240);

    // Выбор через строку инвентаризации: 3D показывает общий selection.
    await inventoryRows(page).first().getByRole('button').first().click();

    await switchTo(page, '3D');
    await expect(page.getByTestId('view3d-canvas')).toBeVisible();
    await expect(page.getByTestId('view3d-unavailable')).toHaveCount(0);
    await expect(page.getByTestId('view3d-error')).toHaveCount(0);
    await expect(prisms(page, '[data-selected="true"]')).toHaveCount(1);
    expect(errors).toEqual([]);
    });
  });

  test('демо-план организаторов: зоны и объекты примера видны в 3D', async ({ playwright, browserName, baseURL }) => {
    await withBrowser({ playwright, browserName, baseURL }, SWIFTSHADER_ARGS, async (page) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByTestId('plan-file-input').setInputFiles(examplePlanFile());
    await expect(inventoryRows(page).first()).toBeVisible();
    const inventoryCount = await inventoryRows(page).count();

    await switchTo(page, '3D');
    await expect(page.getByTestId('view3d-canvas')).toBeVisible();
    const zones = prisms(page, '[data-kind="zone"]');
    const objects = prisms(page, '[data-kind="object"]');
    expect(await zones.count()).toBeGreaterThanOrEqual(3);
    // Один объект — одна призма: список 3D совпадает с инвентаризацией.
    await expect(objects).toHaveCount(inventoryCount);
    await expect(prisms(page, '[data-id="z_client"]')).toHaveCount(1);
    await expect(prisms(page, '[data-id="eq_kiosk"]')).toHaveCount(1);
    // Подпись повторяет числа документа: сцена и план — одно состояние.
    await expect(page.getByText(`объектов: ${inventoryCount}`)).toBeVisible();

    // Уход из 3D освобождает сцену: canvas удалён, ошибок в консоли нет.
    await switchTo(page, '2D');
    await expect(page.getByTestId('view3d-canvas')).toHaveCount(0);
    expect(errors).toEqual([]);
    });
  });
});

test.describe('3D-вид: WebGL выключен', () => {
  test('понятное сообщение вместо пустого экрана, 2D работает', async ({ playwright, browserName, baseURL }) => {
    await withBrowser({ playwright, browserName, baseURL }, NO_WEBGL_ARGS, async (page) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await placeFirstLibraryItem(page, 320, 240);

    await switchTo(page, '3D');
    await expect(page.getByTestId('view3d-unavailable')).toContainText('WebGL');
    await expect(page.getByTestId('view3d-canvas')).toHaveCount(0);
    // Список примитивов есть и без WebGL: сцена как данные строится всегда.
    await expect(prisms(page, '[data-kind="object"]')).toHaveCount(1);

    await switchTo(page, '2D');
    await placeFirstLibraryItem(page, 420, 300);
    await expect(inventoryRows(page)).toHaveCount(2);
    expect(errors).toEqual([]);
    });
  });
});
