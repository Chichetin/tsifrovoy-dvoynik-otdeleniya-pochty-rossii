/**
 * U02 в браузере: история правок с клавиатуры.
 *
 * Обещания: Ctrl+Z отменяет последнюю команду, Ctrl+Y и Ctrl+Shift+Z её
 * возвращают — ровно то же, что кнопки «Отменить» и «Вернуть» в шапке; в поле
 * карточки Ctrl+Z принадлежит тексту, объект на плане при этом не исчезает.
 *
 * Результат читается из перечня инвентаризации и карточки, не с картинки.
 */

import { expect, test, type Page } from './fixtures';
import { showTab } from './side-tabs';

const RACK = 'Стеллаж для посылок';

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
  await showTab(page, 'Библиотека');
  await page.locator('.library__item', { hasText: label }).first().click();
  await settle(page);
  await page.getByTestId('editor-canvas').click({ position: { x, y } });
  await page.getByRole('button', { name: 'Выбор', exact: true }).click();
}

test.describe('история правок с клавиатуры', () => {
  test('Ctrl+Z отменяет установку объекта, Ctrl+Y и Ctrl+Shift+Z возвращают', async ({ page }) => {
    await page.goto('/');
    await placeFromLibrary(page, RACK, 420, 330);
    await expect(inventoryRows(page)).toHaveCount(1);

    await page.keyboard.press('Control+z');
    await expect(inventoryRows(page)).toHaveCount(0);

    await page.keyboard.press('Control+y');
    await expect(inventoryRows(page)).toHaveCount(1);

    await page.keyboard.press('Control+z');
    await expect(inventoryRows(page)).toHaveCount(0);

    await page.keyboard.press('Control+Shift+z');
    await expect(inventoryRows(page)).toHaveCount(1);
  });

  test('в поле карточки Ctrl+Z правит текст, объект остаётся на плане', async ({ page }) => {
    await page.goto('/');
    await placeFromLibrary(page, RACK, 420, 330);
    await inventoryRows(page).first().getByRole('button').first().click();

    const name = card(page).getByLabel('Название');
    await name.click();
    await name.press('End');
    await name.pressSequentially(' ×');
    await name.press('Control+z');

    await expect(inventoryRows(page)).toHaveCount(1);
    await expect(name).toBeFocused();
  });

  test('кнопки шапки подсказывают сочетание клавиш', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Отменить' })).toHaveAttribute('title', /Ctrl\+Z/);
    await expect(page.getByRole('button', { name: 'Вернуть' })).toHaveAttribute('title', /Ctrl\+Y/);
  });
});
