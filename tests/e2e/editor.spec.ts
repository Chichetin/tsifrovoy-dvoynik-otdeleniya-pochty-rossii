/**
 * The scenario the jury runs by hand: open the editor, draw a zone, place
 * equipment, save the plan, open the saved file again and find everything
 * where it was.
 *
 * This file is the one that grows with the product — every package that joins
 * the editor adds a step here through the owner of the scenario.
 */

import { readFileSync } from 'node:fs';
import { expect, test, type Page , exportPlan, expectUnsavedEdits } from './fixtures';
import { showTab } from './side-tabs';

/** Клик по холсту в пикселях от его левого верхнего угла. */
async function clickCanvas(page: Page, x: number, y: number): Promise<void> {
  const canvas = page.getByTestId('editor-canvas');
  await canvas.click({ position: { x, y } });
}

async function placeFirstLibraryItem(page: Page, x: number, y: number): Promise<string> {
  await showTab(page, 'Библиотека');
  const item = page.locator('.library__item').first();
  const label = ((await item.locator('.library__label').textContent()) ?? '').trim();
  await item.click();
  await clickCanvas(page, x, y);
  return label;
}

test.describe('сквозной сценарий редактора', () => {
  test('открыть → изменить → сохранить → открыть заново', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Цифровой двойник ОПС' })).toBeVisible();
    // Konva рисует по canvas на слой: сетка, план, оборудование.
    await expect(page.locator('canvas').first()).toBeVisible();
    await expect(page.getByTestId('canvas-scale')).toContainText('Сетка');

    // Пустой план: инвентаризация пуста, нарушений нет.
    await expect(page.getByText('Оборудование ещё не размещено')).toBeVisible();

    // Зона: четыре точки и клик по первой, чтобы замкнуть.
    await page.getByRole('toolbar', { name: 'Инструменты плана' }).getByRole('button', { name: 'Зона', exact: true }).click();
    await clickCanvas(page, 200, 180);
    await clickCanvas(page, 430, 180);
    await clickCanvas(page, 430, 360);
    await clickCanvas(page, 200, 360);
    await clickCanvas(page, 200, 180);

    await page.getByRole('button', { name: 'Выбор', exact: true }).click();
    // Зона выбирается кликом по её полу (в перечне зон рядом — только названия).
    await clickCanvas(page, 300, 270);
    await expect(page.getByLabel('Свойства')).toHaveAttribute('data-entity-id', 'z_1');

    // Оборудование: первый тип библиотеки внутрь нарисованной зоны.
    const placed = await placeFirstLibraryItem(page, 300, 260);
    // В библиотеке и в перечне одинаковая подпись — берём строку перечня.
    await expect(page.locator('.table__link', { hasText: placed }).first()).toBeVisible();

    await showTab(page, 'Инвентаризация');
    const inventoryRows = page.getByLabel('Инвентаризация').locator('tbody tr').first();
    await expect(inventoryRows).toBeVisible();
    await expectUnsavedEdits(page, true);

    // Площади считаются от нарисованного, а не от шаблона: свободного пола
    // стало меньше площади помещения.
    const free = await page.getByTestId('room-free').textContent();
    // Запись по-русски (D-197): «95,12 м²» — запятая и неразрывный пробел.
    expect(free).toMatch(/^\d[\d\u00a0]*,\d\d\u00a0м²$/);
    expect(Number((free ?? '0').replace(/[\s\u00a0]|м²/g, '').replace(',', '.'))).toBeLessThan(12 * 9);

    // Сохранение: файл уходит в загрузки с тем, что нарисовано.
    const download = await Promise.all([
      page.waitForEvent('download'),
      exportPlan(page, 'JSON'),
    ]).then(([event]) => event);

    const saved = await download.path();
    expect(saved).not.toBeNull();

    const text = readFileSync(saved as string, 'utf8');
    const parsed = JSON.parse(text) as { zones: unknown[]; objects: unknown[] };
    expect(parsed.zones).toHaveLength(1);
    expect(parsed.objects).toHaveLength(1);

    // Новый план стирает всё — это состояние, из которого открываем файл.
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Файл' }).click();
    await page.getByRole('menuitem', { name: 'Создать новый' }).click();
    await expect(page.getByText('Оборудование ещё не размещено')).toBeVisible();

    // Повторное открытие: зона, объект и их идентификаторы на месте.
    await page.getByTestId('plan-file-input').setInputFiles(saved as string);
    await expect(inventoryRows).toBeVisible();
    await expect(page.locator('.table__link', { hasText: placed }).first()).toBeVisible();
    await expect(page.locator('.table__link', { hasText: 'z_1' }).first()).toBeVisible();
    await expectUnsavedEdits(page, false);

    await testInfo.attach('сохранённый план', { body: text, contentType: 'application/json' });
    expect(errors).toEqual([]);
  });

  test('битый файл не подменяет открытый план', async ({ page }) => {
    await page.goto('/');
    await placeFirstLibraryItem(page, 320, 240);
    await showTab(page, 'Инвентаризация');
    const rows = page.getByLabel('Инвентаризация').locator('tbody tr');
    await expect(rows).toHaveCount(1);

    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByTestId('plan-file-input').setInputFiles({
      name: 'broken.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"schemaVersion": 1, "zones": ['),
    });

    // Сотруднику — понятная фраза, технический код спрятан в раскрытии (MR !215).
    await expect(page.getByRole('alert')).toContainText('не соответствует поддерживаемому формату');
    await page.getByTestId('file-error-details').locator('summary').click();
    await expect(page.getByTestId('file-error-details')).toContainText('DOCUMENT_UNREADABLE');
    // Документ остался на месте: строка инвентаризации не пропала.
    await expect(rows).toHaveCount(1);
  });

  test('отмена возвращает удалённую правку', async ({ page }) => {
    await page.goto('/');
    await placeFirstLibraryItem(page, 320, 240);
    await showTab(page, 'Инвентаризация');
    const rows = page.getByLabel('Инвентаризация').locator('tbody tr');
    await expect(rows).toHaveCount(1);

    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(page.getByText('Оборудование ещё не размещено')).toBeVisible();

    await page.getByRole('button', { name: 'Вернуть' }).click();
    await expect(rows).toHaveCount(1);
  });
});
