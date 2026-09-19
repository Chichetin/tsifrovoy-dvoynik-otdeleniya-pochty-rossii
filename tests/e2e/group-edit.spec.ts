/**
 * U07 в браузере: правка выбранного с клавиатуры.
 *
 * Обещания: стрелка двигает объект на шаг и пишет в модель точное число,
 * Shift+стрелка — мелкий шаг, Ctrl+C/Ctrl+V делает копию со свежим id и
 * видимым смещением, одно нажатие — одна команда и одно «Отменить», а клавиша,
 * нажатая в поле карточки, принадлежит полю (находка operator №18).
 *
 * Числа читаются из карточки свойств и сохранённого JSON, не с картинки.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const RACK = 'Шкаф / стеллаж для посылок';

/** Шаги из src/features/equipment/selection-edit.ts. */
const NUDGE_STEP_M = 0.5;
const NUDGE_FINE_STEP_M = 0.05;
const PASTE_OFFSET_M = [0.5, -0.5] as const;

const card = (page: Page) => page.getByLabel('Свойства');
const inventoryRows = (page: Page) =>
  page.getByLabel('Инвентаризация').locator('table').first().locator('tbody tr');

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
  await page.getByTestId('editor-canvas').click({ position: { x, y } });
  await page.getByRole('button', { name: 'Выбор', exact: true }).click();
}

async function selectRow(page: Page, index: number): Promise<void> {
  await inventoryRows(page).nth(index).getByRole('button').first().click();
}

async function positionOf(page: Page): Promise<[number, number]> {
  return [
    Number(await card(page).getByLabel('X, м').inputValue()),
    Number(await card(page).getByLabel('Y, м').inputValue()),
  ];
}

/**
 * Карточка перерисовывается после команды, а число в ней округлено до
 * сантиметра: сравниваем числами с допуском, а не строками — 7.56 + 0.5 в
 * двоичной дроби даёт 8.059999999999999, а в модели лежит ровно 8.06.
 */
async function expectPosition(page: Page, x: number, y: number): Promise<void> {
  await expect.poll(async () => (await positionOf(page))[0]).toBeCloseTo(x, 5);
  await expect.poll(async () => (await positionOf(page))[1]).toBeCloseTo(y, 5);
}

/** Зона объекта — подсказка карточки «Зона: …; пересчитывается по геометрии». */
async function zoneOf(page: Page): Promise<string> {
  const text = (await page.getByTestId('props-zone').textContent()) ?? '';
  return text.replace(/^Зона:\s*/, '').replace(/;.*$/, '').trim();
}

async function savedPlan(page: Page): Promise<{ objects: { id: string; position: number[] }[] }> {
  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Сохранить' }).click(),
  ]).then(([event]) => event);
  const path = await download.path();
  expect(path).not.toBeNull();
  return JSON.parse(readFileSync(path as string, 'utf8')) as {
    objects: { id: string; position: number[] }[];
  };
}

async function openDemo(page: Page): Promise<void> {
  await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'demo', 'before.json'));
  await expect(inventoryRows(page)).toHaveCount(53);
}

test.describe('правка выбранного с клавиатуры', () => {
  test('стрелка двигает на шаг, Shift+стрелка — мелким шагом, «Отменить» возвращает', async ({
    page,
  }) => {
    await page.goto('/');
    await placeFromLibrary(page, RACK, 420, 330);
    await selectRow(page, 0);

    const [x0, y0] = await positionOf(page);

    await page.keyboard.press('ArrowRight');
    await expectPosition(page, x0 + NUDGE_STEP_M, y0);

    // Вверх по экрану — это +Y модели (D-010).
    await page.keyboard.press('ArrowUp');
    await expectPosition(page, x0 + NUDGE_STEP_M, y0 + NUDGE_STEP_M);

    await page.keyboard.press('Shift+ArrowLeft');
    await expectPosition(page, x0 + NUDGE_STEP_M - NUDGE_FINE_STEP_M, y0 + NUDGE_STEP_M);

    // Три нажатия — три команды; последнее «Отменить» снимает мелкий шаг.
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expectPosition(page, x0 + NUDGE_STEP_M, y0 + NUDGE_STEP_M);
  });

  test('стрелка в поле карточки правит текст, а не двигает объект', async ({ page }) => {
    await page.goto('/');
    await placeFromLibrary(page, RACK, 420, 330);
    await selectRow(page, 0);
    const [x0, y0] = await positionOf(page);

    // Курсор в поле названия: стрелки там ходят по тексту.
    await card(page).getByLabel('Название').click();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowLeft');

    expect(await positionOf(page)).toEqual([x0, y0]);
  });

  test('Ctrl+C и Ctrl+V дают копию со свежим id и смещением, вторая вставка уходит дальше', async ({
    page,
  }) => {
    await page.goto('/');
    await placeFromLibrary(page, RACK, 420, 330);
    await selectRow(page, 0);
    const [x0, y0] = await positionOf(page);

    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');

    await expect(inventoryRows(page)).toHaveCount(2);
    // Вставленное выбрано: карточка уже показывает копию.
    const [x1, y1] = await positionOf(page);
    expect(x1).toBeCloseTo(x0 + PASTE_OFFSET_M[0], 5);
    expect(y1).toBeCloseTo(y0 + PASTE_OFFSET_M[1], 5);

    // Вторая вставка из того же буфера не ложится на первую.
    await page.keyboard.press('Control+v');
    await expect(inventoryRows(page)).toHaveCount(3);
    const [x2, y2] = await positionOf(page);
    expect(x2).toBeCloseTo(x0 + PASTE_OFFSET_M[0] * 2, 5);
    expect(y2).toBeCloseTo(y0 + PASTE_OFFSET_M[1] * 2, 5);

    // В файле три разных id и три разные позиции — копии не делят ничего.
    const plan = await savedPlan(page);
    expect(plan.objects).toHaveLength(3);
    expect(new Set(plan.objects.map((object) => object.id)).size).toBe(3);

    // Одна вставка — одна команда: «Отменить» снимает копию целиком.
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(inventoryRows(page)).toHaveCount(2);
  });

  test('вставка после удаления не переиспользует удалённый id (D-156)', async ({ page }) => {
    await page.goto('/');
    await placeFromLibrary(page, RACK, 380, 300);
    await placeFromLibrary(page, RACK, 520, 300);
    await expect(inventoryRows(page)).toHaveCount(2);

    // Копируем первый, второй удаляем — его id уходит в retired.
    await selectRow(page, 0);
    await page.keyboard.press('Control+c');
    await selectRow(page, 1);
    await page.keyboard.press('Delete');
    await expect(inventoryRows(page)).toHaveCount(1);

    await selectRow(page, 0);
    await page.keyboard.press('Control+v');

    // Копия появилась, полоса отказа молчит: id взят мимо удалённого.
    await expect(inventoryRows(page)).toHaveCount(2);
    await expect(page.getByText('Правка отклонена')).toHaveCount(0);

    const plan = await savedPlan(page);
    const ids = plan.objects.map((object) => object.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('на демо-плане: копия и сдвиг стрелкой, связь с зоной пересчитана', async ({ page }) => {
    await page.goto('/');
    await openDemo(page);

    await selectRow(page, 0);
    const zone = await zoneOf(page);
    expect(zone).not.toBe('вне зон');
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');

    await expect(inventoryRows(page)).toHaveCount(54);
    // Копия вставлена рядом с оригиналом, и её зона пересчитана по месту, а не
    // скопирована: `pasteObjects` отдаёт zoneId=null, зону ставит object.put.
    await expect.poll(() => zoneOf(page)).toBe(zone);

    const [x0, y0] = await positionOf(page);
    await page.keyboard.press('ArrowRight');
    await expectPosition(page, x0 + NUDGE_STEP_M, y0);

    const plan = await savedPlan(page);
    expect(plan.objects).toHaveLength(54);
    expect(new Set(plan.objects.map((object) => object.id)).size).toBe(54);
  });
});
