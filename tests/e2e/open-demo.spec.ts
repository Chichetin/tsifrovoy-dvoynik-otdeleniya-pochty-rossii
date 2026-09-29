import { readFileSync } from 'node:fs';
import { expect, test, exportPlan, passPhysicsBlock } from './fixtures';
import { expandInventoryRows } from './inventory-collapse';

const before = JSON.parse(readFileSync('demo/before.json', 'utf8'));
const after = JSON.parse(readFileSync('demo/after.json', 'utf8'));
async function openDemo(page: import('@playwright/test').Page, label: string) {
  await page.getByRole('button', { name: 'Демо', exact: true }).click();
  await page.getByRole('menuitem', { name: label }).click();
}
async function save(page: import('@playwright/test').Page) {
  const downloading = page.waitForEvent('download');
  await exportPlan(page, 'JSON');
  await passPhysicsBlock(page);
  const download = await downloading;
  return { path: (await download.path())!, plan: JSON.parse(readFileSync((await download.path())!, 'utf8')) };
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }]) {
  test(`первый вход → выбор демо → правка → сохранить → открыть (${viewport.width})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    // Reopen the real first step: fixture only suppresses automatic tour display.
    await page.getByRole('button', { name: 'Обучение', exact: true }).click();
    await page.getByRole('button', { name: 'Исходный демо-план', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Обучение' })).toBeHidden();
    await expect(page.getByTestId('files-notice')).toContainText(before.name);
    const initial = await save(page);
    expect(initial.plan).toEqual(before);
    // Use the real inventory and properties rather than test-only store access.
    await expandInventoryRows(page);
    await page.locator('.table__link', { hasText: 'Рабочее место оператора' }).first().click();
    await page.getByLabel('Свойства').getByLabel('Название', { exact: true }).fill('Демо — моя правка');
    const edited = await save(page);
    expect(edited.plan.objects.some((object: { label: string }) => object.label === 'Демо — моя правка')).toBe(true);
    await page.getByTestId('plan-file-input').setInputFiles(edited.path);
    expect((await save(page)).plan).toEqual(edited.plan);
    await page.getByRole('button', { name: 'Демо', exact: true }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Исходный демо-план' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Изменённый демо-план' })).toBeFocused();
    await page.screenshot({ path: `docs/verification/2026-09-28-open-demo-${viewport.width}.png` });
    page.once('dialog', (dialog) => void dialog.accept());
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('files-notice')).toContainText(after.name);
    expect((await save(page)).plan).toEqual(after);
    const header = await page.locator('.shell__bar').boundingBox();
    const fileGroup = await page.getByRole('group', { name: 'Файл плана' }).boundingBox();
    expect(fileGroup!.x + fileGroup!.width).toBeLessThanOrEqual(viewport.width);
    expect(fileGroup!.y + fileGroup!.height).toBeLessThanOrEqual(header!.y + header!.height);
  });
}

test('отказ замены и HTTP/JSON ошибки сохраняют открытый план', async ({ page }) => {
  await page.goto('/');
  await openDemo(page, 'Изменённый демо-план');
  await expect(page.getByTestId('files-notice')).toContainText(after.name);
  page.once('dialog', (dialog) => void dialog.dismiss());
  await openDemo(page, 'Исходный демо-план');
  expect((await save(page)).plan).toEqual(after);
  await page.route('**/demo/before.json', (route) => route.fulfill({ status: 503, body: 'unavailable' }));
  page.once('dialog', (dialog) => void dialog.accept());
  await openDemo(page, 'Исходный демо-план');
  await expect(page.locator('.files__error')).toContainText('HTTP 503');
  expect((await save(page)).plan).toEqual(after);
  await page.unroute('**/demo/before.json');
  await page.route('**/demo/before.json', (route) => route.fulfill({ body: '{broken' }));
  page.once('dialog', (dialog) => void dialog.accept());
  await openDemo(page, 'Исходный демо-план');
  await expect(page.locator('.files__error')).toContainText('не соответствует');
  expect((await save(page)).plan).toEqual(after);
});

test('поздний запрос демо не заменяет более новый выбор', async ({ page }) => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/demo/before.json', async (route) => {
    await waiting;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(before) }).catch(() => undefined);
  });
  await page.goto('/');
  await openDemo(page, 'Исходный демо-план');
  await expect(page.getByTestId('files-loading')).toContainText('загружаем демо');
  await openDemo(page, 'Изменённый демо-план');
  await expect(page.getByTestId('files-notice')).toContainText(after.name);
  release();
  expect((await save(page)).plan).toEqual(after);
});
