/**
 * U04 в браузере: групповой выбор и групповая правка (D-184, D-185).
 *
 * Обещания: рамка по пустому полу под инструментом «Выбор» собирает объекты,
 * которых коснулась; Shift+клик добавляет и убирает; стрелка, Delete, Ctrl+C/V
 * и перетаскивание действуют на всю группу, и каждое действие — одно «Отменить»;
 * рамка, не поймавшая ничего, не выбирает пол под собой.
 *
 * Числа читаются из карточки, перечня и сохранённого JSON, не с картинки.
 */

import { readFileSync } from 'node:fs';
import { expect, test, type Page } from './fixtures';

const RACK = 'Шкаф / стеллаж для посылок';
/** Шаг стрелки из src/features/equipment/selection-edit.ts. */
const NUDGE_STEP_M = 0.5;

const card = (page: Page) => page.getByLabel('Свойства');
const groupNote = (page: Page) => page.getByTestId('props-group');
const inventoryRows = (page: Page) =>
  page.getByLabel('Инвентаризация').locator('table').first().locator('tbody tr');
const canvas = (page: Page) => page.getByTestId('editor-canvas');

async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function placeFromLibrary(page: Page, label: string, x: number, y: number): Promise<void> {
  await page.locator('.library__item', { hasText: label }).first().click();
  await settle(page);
  await canvas(page).click({ position: { x, y } });
  await page.getByRole('button', { name: 'Выбор', exact: true }).click();
}

/** Три стеллажа в ряд; возвращает их положения из сохранённого файла. */
async function threeRacks(page: Page): Promise<void> {
  await page.goto('/');
  await placeFromLibrary(page, RACK, 300, 300);
  await placeFromLibrary(page, RACK, 420, 300);
  await placeFromLibrary(page, RACK, 540, 300);
  await expect(inventoryRows(page)).toHaveCount(3);
}

async function drag(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const box = await canvas(page).boundingBox();
  if (box === null) throw new Error('холст не найден');
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  // Несколько шагов: порог начала рамки и перетаскивания — несколько пикселей.
  await page.mouse.move(box.x + (from[0] + to[0]) / 2, box.y + (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 4 });
  await page.mouse.up();
  await settle(page);
}

/** Рамка вокруг всех трёх стеллажей; начинается на пустом полу. */
async function marqueeAll(page: Page): Promise<void> {
  await drag(page, [240, 240], [600, 360]);
  await expect(groupNote(page)).toContainText('Выбрано объектов: 3');
}

type Saved = { objects: { id: string; position: [number, number] }[] };

async function savedPlan(page: Page): Promise<Saved> {
  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Сохранить' }).click(),
  ]).then(([event]) => event);
  const path = await download.path();
  expect(path).not.toBeNull();
  return JSON.parse(readFileSync(path as string, 'utf8')) as Saved;
}

const positions = (plan: Saved): Record<string, [number, number]> =>
  Object.fromEntries(plan.objects.map((object) => [object.id, object.position]));

test.describe('групповой выбор', () => {
  test('рамка собирает объекты, стрелка двигает все, одно «Отменить» возвращает все', async ({
    page,
  }) => {
    await threeRacks(page);
    const before = positions(await savedPlan(page));

    await marqueeAll(page);
    await page.keyboard.press('ArrowRight');

    const after = positions(await savedPlan(page));
    for (const id of Object.keys(before)) {
      expect(after[id]![0]).toBeCloseTo(before[id]![0] + NUDGE_STEP_M, 5);
      expect(after[id]![1]).toBeCloseTo(before[id]![1], 5);
    }

    await page.keyboard.press('Control+z');
    expect(positions(await savedPlan(page))).toEqual(before);
    // Группа пережила отмену: объекты те же, выбор при них.
    await expect(groupNote(page)).toContainText('Выбрано объектов: 3');
  });

  test('Delete удаляет группу, одно «Отменить» возвращает всех', async ({ page }) => {
    await threeRacks(page);
    await marqueeAll(page);

    await page.keyboard.press('Delete');
    await expect(inventoryRows(page)).toHaveCount(0);

    await page.keyboard.press('Control+z');
    await expect(inventoryRows(page)).toHaveCount(3);
  });

  test('Shift+клик убирает из группы и добавляет в неё', async ({ page }) => {
    await threeRacks(page);
    await marqueeAll(page);

    await canvas(page).click({ position: { x: 420, y: 300 }, modifiers: ['Shift'] });
    await expect(groupNote(page)).toContainText('Выбрано объектов: 2');

    await canvas(page).click({ position: { x: 420, y: 300 }, modifiers: ['Shift'] });
    await expect(groupNote(page)).toContainText('Выбрано объектов: 3');

    // Обычный клик — выбор одного: заметки о группе нет.
    await canvas(page).click({ position: { x: 420, y: 300 } });
    await expect(groupNote(page)).toHaveCount(0);
    await expect(card(page)).toContainText('Свойства объекта');
  });

  test('Ctrl+C и Ctrl+V копируют группу одним шагом истории', async ({ page }) => {
    await threeRacks(page);
    await marqueeAll(page);

    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await expect(inventoryRows(page)).toHaveCount(6);
    // Вставленные копии — новая группа того же размера.
    await expect(groupNote(page)).toContainText('Выбрано объектов: 3');

    await page.keyboard.press('Control+z');
    await expect(inventoryRows(page)).toHaveCount(3);
  });

  test('перетаскивание одного члена двигает всю группу на тот же сдвиг', async ({ page }) => {
    await threeRacks(page);
    const before = positions(await savedPlan(page));
    await marqueeAll(page);

    // Схвачен средний (eq_2): остальные обязаны уехать ровно на его сдвиг.
    // Сам сдвиг меньше пройденных пикселей на порог начала drag в Konva,
    // поэтому сравнивается не с числом, а со сдвигом схваченного.
    await drag(page, [420, 300], [516, 300]);

    const after = positions(await savedPlan(page));
    const dx = after['eq_2']![0] - before['eq_2']![0];
    expect(dx).toBeGreaterThan(1.5);
    for (const id of Object.keys(before)) {
      expect(after[id]![0]).toBeCloseTo(before[id]![0] + dx, 5);
      expect(after[id]![1]).toBeCloseTo(before[id]![1], 5);
    }

    await page.keyboard.press('Control+z');
    expect(positions(await savedPlan(page))).toEqual(before);
  });

  test('пустая рамка снимает выбор и не выбирает пол под собой', async ({ page }) => {
    await threeRacks(page);
    await canvas(page).click({ position: { x: 420, y: 300 } });
    await expect(card(page)).toContainText('Свойства объекта');

    await drag(page, [100, 380], [200, 420]);

    await expect(card(page)).not.toContainText('Свойства объекта');
    await expect(card(page)).not.toContainText('Свойства помещения');
  });
});
