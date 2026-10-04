/** Q01: one user's change must survive a real file download and page reload. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test , exportPlan, confirmPhysicsBlock } from './fixtures';
import { expandInventoryRows } from './inventory-collapse';
import { showTab } from './side-tabs';
import { closeSettings, openSettings } from './settings';

const EXAMPLE = join(process.cwd(), 'example_plan.json');

test('готовый план → правка → файл → новая страница → те же данные', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByTestId('plan-file-input').setInputFiles(EXAMPLE);

  await showTab(page, 'Инвентаризация');
  const inventory = page.getByLabel('Инвентаризация').locator('table').first().locator('tbody tr');
  await expect(inventory).toHaveCount(12);
  // Перечень свёрнут по умолчанию — «Терминал электронной очереди» стоит не
  // среди первых трёх, список нужно раскрыть.
  await expandInventoryRows(page);
  await inventory.filter({ hasText: 'Терминал электронной очереди' }).getByRole('button').first().click();

  const card = page.getByLabel('Свойства');
  await expect(card).toHaveAttribute('data-entity-id', 'eq_kiosk');
  // Координаты — одна правка: физика проверяет итоговую точку, а не
  // промежуточное положение при редактировании первого поля (#1).
  await card.getByLabel('Y, м').fill('2.1');
  await card.getByLabel('X, м').fill('1.1');
  await card.getByRole('button', { name: 'Применить координаты' }).click();
  await card.getByLabel('Поворот, °').fill('90');
  // The organizer catalog has no editable attributes for this type; a second
  // Q01 scenario covers a catalog-defined attribute. Rename this object here.
  await card.getByLabel('Название').fill('Терминал очереди Q01');
  await expect(card.getByTestId('props-zone')).toHaveText('Зона: Клиентская зона');

  // Пример организаторов приносит нарушения физики (три коллизии и три
  // пересечения стен): сохранение спрашивает, проверяющий подтверждает (D-286).
  const started = page.waitForEvent('download');
  await exportPlan(page, 'JSON');
  await confirmPhysicsBlock(page);
  const download = await started;
  const file = await download.path();
  expect(file).not.toBeNull();
  const before = JSON.parse(readFileSync(file as string, 'utf8'));
  expect(before.objects.find((object: { id: string }) => object.id === 'eq_kiosk')).toMatchObject({
    id: 'eq_kiosk', position: [1.1, 2.1], rotation_deg: 90,
    zoneId: 'z_client', label: 'Терминал очереди Q01',
  });
  expect(before.zones).toHaveLength(4);

  await page.reload();
  await page.getByTestId('plan-file-input').setInputFiles(file as string);
  await expect(inventory).toHaveCount(12);
  // Новая страница — новое, свёрнутое по умолчанию, состояние панели.
  await expandInventoryRows(page);
  await inventory.filter({ hasText: 'Терминал очереди Q01' }).getByRole('button').first().click();
  await expect(card.getByLabel('X, м')).toHaveValue('1.1');
  await expect(card.getByLabel('Y, м')).toHaveValue('2.1');
  await expect(card.getByLabel('Поворот, °')).toHaveValue('90');
  await expect(card.getByLabel('Название')).toHaveValue('Терминал очереди Q01');

  const restarted = page.waitForEvent('download');
  await exportPlan(page, 'JSON');
  await confirmPhysicsBlock(page);
  const again = await restarted;
  const second = await again.path();
  expect(second).not.toBeNull();
  const after = JSON.parse(readFileSync(second as string, 'utf8'));
  expect(after).toEqual(before); // IDs, geometry, catalog, attributes, layers and links.
  expect(errors).toEqual([]);
});

test('инвентарный номер новой скамьи выдан при постановке и переживает файл (D-310)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'demo', 'before.json'));
  const inventory = page.getByLabel('Инвентаризация').locator('table').first().locator('tbody tr');
  await expect(inventory).toHaveCount(53);

  // Та же точка свободного пола, что в demo.spec.ts: (120, 456) — модель (2,2; 2).
  await showTab(page, 'Библиотека');
  await page.locator('.library__item', { hasText: 'Скамья для ожидания' }).first().click();
  await page.getByTestId('editor-canvas').click({ position: { x: 120, y: 456 } });
  await page.getByRole('button', { name: 'Выбор', exact: true }).click();
  await expect(inventory).toHaveCount(54);

  const card = page.getByLabel('Свойства');
  const openBench = async (): Promise<void> => {
    await showTab(page, 'Инвентаризация');
    await expandInventoryRows(page);
    await page.getByLabel('Инвентаризация').locator('tbody tr', { hasText: 'ИНВ-ДЕМО-054' }).getByRole('button').first().click();
    await expect(card).toHaveAttribute('data-entity-id', 'eq_54');
  };
  await openBench();
  // Следующий номер серии плана: последний в before.json — ИНВ-ДЕМО-053.
  await expect(card.getByLabel('Инвентарный номер')).toHaveValue('ИНВ-ДЕМО-054');

  const started = page.waitForEvent('download');
  await exportPlan(page, 'JSON');
  const file = await (await started).path();
  expect(file).not.toBeNull();
  const saved = JSON.parse(readFileSync(file as string, 'utf8'));
  const numbers = (plan: { objects: { id: string; attributes: Record<string, unknown> }[] }) =>
    plan.objects.map((object) => [object.id, object.attributes['inventoryNumber']]);
  expect(numbers(saved)).toContainEqual(['eq_54', 'ИНВ-ДЕМО-054']);

  await page.reload();
  await page.getByTestId('plan-file-input').setInputFiles(file as string);
  await expect(inventory).toHaveCount(54);
  await openBench();
  await expect(card.getByLabel('Инвентарный номер')).toHaveValue('ИНВ-ДЕМО-054');

  // «Экспорт → CSV» несёт столбец атрибута из справочника и новую скамью (#12).
  const csvStarted = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Файл' }).click();
  await page.getByRole('menuitem', { name: /CSV/ }).click();
  const csvFile = await (await csvStarted).path();
  const [header, ...lines] = readFileSync(csvFile as string, 'utf8').replace(/^\uFEFF/, '').split('\r\n');
  expect(header?.split(';')).toContain('Состояние');
  expect(lines.some((line) => line.startsWith('ИНВ-ДЕМО-054;'))).toBe(true);

  const again = page.waitForEvent('download');
  await exportPlan(page, 'JSON');
  const second = await (await again).path();
  expect(second).not.toBeNull();
  expect(numbers(JSON.parse(readFileSync(second as string, 'utf8')))).toEqual(numbers(saved));
  expect(errors).toEqual([]);
});

test('атрибут типа добавлен без ввода ключа и попал в сохранённый справочник (#13)', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'demo', 'before.json'));
  const dialog = await openSettings(page, 'Оборудование');
  await dialog.getByTestId('catalog-type-label').fill('Весы почтовые Q13');
  await dialog.getByTestId('catalog-add-type').click();
  await dialog.getByTestId('catalog-attr-label').fill('Дата поверки');
  await expect(dialog.getByTestId('catalog-attr-key-preview')).toHaveText('Ключ: data_poverki');
  await dialog.getByTestId('catalog-add-attr').click();
  await expect(dialog.getByTestId('catalog-attributes')).toContainText('data_poverki');
  await closeSettings(page);

  const started = page.waitForEvent('download');
  await exportPlan(page, 'JSON');
  const download = await started;
  const saved = JSON.parse(readFileSync((await download.path()) as string, 'utf8'));
  const type = saved.catalog.objectTypes.find((t: { label: string }) => t.label === 'Весы почтовые Q13');
  expect(type.attributes.map((a: { key: string }) => a.key)).toEqual(['data_poverki']);
});

/** Файл, брошенный в окно: те же события, что шлёт браузер при перетаскивании из проводника (#37). */
async function dropFile(page: import('@playwright/test').Page, name: string, content: string, type: string): Promise<void> {
  await page.evaluate(
    ([fileName, text, mime]) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([text], fileName, { type: mime }));
      for (const kind of ['dragenter', 'dragover', 'drop']) {
        document.body.dispatchEvent(new DragEvent(kind, { bubbles: true, cancelable: true, dataTransfer: transfer }));
      }
    },
    [name, content, type] as const,
  );
}

test('план, брошенный в окно, открывается; битый и не-JSON файл дают ошибку и не портят открытый (#37)', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/');
  const rows = page.getByLabel('Инвентаризация').locator('table').first().locator('tbody tr');

  await dropFile(page, 'before.json', readFileSync(join(process.cwd(), 'demo', 'before.json'), 'utf8'), 'application/json');
  await expect(rows).toHaveCount(53);

  await dropFile(page, 'broken.json', '{"план": не json', 'application/json');
  await expect(page.getByText('План не открыт')).toBeVisible();
  await dropFile(page, 'picture.png', 'PNG', 'image/png');
  await expect(page.getByText('нужен план в формате JSON')).toBeVisible();
  await expect(rows).toHaveCount(53);
});
