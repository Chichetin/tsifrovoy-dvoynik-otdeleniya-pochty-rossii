import { readFileSync } from 'node:fs';
import { expect, test, exportPlan, passPhysicsBlock } from './fixtures';
import { expandInventoryRows } from './inventory-collapse';

const before = JSON.parse(readFileSync('demo/before.json', 'utf8'));
const after = JSON.parse(readFileSync('demo/after.json', 'utf8'));
async function openDemo(page: import('@playwright/test').Page, label: string) {
  await page.getByRole('button', { name: 'Файл' }).click();
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
    await page.getByRole('button', { name: 'Файл' }).focus();
    await page.keyboard.press('ArrowDown');
    // Меню открывается на первом пункте; демо-планы идут дальше по стрелке вниз.
    await expect(page.getByRole('menuitem', { name: 'Создать новый' })).toBeFocused();
    await page.getByRole('menuitem', { name: 'Исходный демо-план' }).focus();
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
  // Сохранённый план заменяется без вопроса (#141). Вопрос задаёт только
  // несохранённая правка — делаем её.
  await expandInventoryRows(page);
  await page.locator('.table__link', { hasText: 'Рабочее место оператора' }).first().click();
  const card = page.getByLabel('Свойства');
  const editedId = await card.getAttribute('data-entity-id');
  await card.getByLabel('Название', { exact: true }).fill('Демо — моя правка');
  await card.getByLabel('Название', { exact: true }).press('Tab');
  const edited = structuredClone(after);
  edited.objects.find((object: { id: string }) => object.id === editedId).label = 'Демо — моя правка';
  let asked = 0;
  page.once('dialog', (dialog) => { asked += 1; void dialog.dismiss(); });
  await openDemo(page, 'Исходный демо-план');
  await expect.poll(() => asked).toBe(1);
  expect((await save(page)).plan).toEqual(edited);
  // Дальше вопрос может быть или не быть: план сохранён. Ошибка загрузки всё
  // равно оставляет открытый план.
  page.on('dialog', (dialog) => void dialog.accept());
  await page.route('**/demo/before.json', (route) => route.fulfill({ status: 503, body: 'unavailable' }));
  await openDemo(page, 'Исходный демо-план');
  await expect(page.locator('.files__error')).toContainText('HTTP 503');
  expect((await save(page)).plan).toEqual(edited);
  await page.unroute('**/demo/before.json');
  await page.route('**/demo/before.json', (route) => route.fulfill({ body: '{broken' }));
  await openDemo(page, 'Исходный демо-план');
  await expect(page.locator('.files__error')).toContainText('не соответствует');
  expect((await save(page)).plan).toEqual(edited);
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
