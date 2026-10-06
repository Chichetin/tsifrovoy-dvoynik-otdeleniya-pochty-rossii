/**
 * UX-3 в браузере: карта горячих клавиш по «?».
 *
 * Обещания: «?» открывает накладку со списком клавиш, повторное «?» и
 * `Escape` закрывают её, кнопка в шапке делает то же самое без клавиатуры,
 * фокус после закрытия возвращается туда, откуда пришёл, а клавиша,
 * нажатая в поле карточки, полю и принадлежит — накладка не открывается.
 * Багфикс после reviewer (MR !199): пока накладка открыта, она глушит
 * клавиатуру редактора (Delete/R/стрелки/Ctrl+D/Ctrl+Z/Y не проходят к
 * плану) и запирает Tab внутри себя.
 */

import { expect, test, type Page } from './fixtures';
import { expandInventoryRows } from './inventory-collapse';
import { showTab } from './side-tabs';

const RACK = 'Стеллаж для посылок';

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Горячие клавиши' });
// D-260: кнопка — иконка в шапке, имя без «(?)», клавиша — в подсказке.
const hotkeysButton = (page: Page) => page.locator('.shell__bar').getByRole('button', { name: 'Горячие клавиши', exact: true });
const inventoryRows = (page: Page) =>
  page.getByLabel('Инвентаризация').locator('table').first().locator('tbody tr');

async function placeFromLibrary(page: Page, label: string, x: number, y: number): Promise<void> {
  await showTab(page, 'Библиотека');
  await page.locator('.library__item', { hasText: label }).first().click();
  await page.getByTestId('editor-canvas').click({ position: { x, y } });
  await page.getByRole('button', { name: 'Выбор', exact: true }).click();
}

async function selectRow(page: Page, index: number): Promise<void> {
  // Перечень свёрнут по умолчанию — строка за пределами первых трёх не
  // кликается, пока список не раскрыт.
  await expandInventoryRows(page);
  await inventoryRows(page).nth(index).getByRole('button').first().click();
}

test.describe('карта горячих клавиш', () => {
  test('? открывает накладку, повторное ? закрывает', async ({ page }) => {
    await page.goto('/');
    await expect(dialog(page)).toHaveCount(0);

    await page.keyboard.press('Shift+Slash');
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByLabel('Ctrl+D', { exact: true })).toBeVisible();

    await page.keyboard.press('Shift+Slash');
    await expect(dialog(page)).toHaveCount(0);
  });

  test('Escape закрывает накладку', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Shift+Slash');
    await expect(dialog(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
  });

  test('кнопка «Горячие клавиши» в шапке открывает накладку, крестик закрывает', async ({ page }) => {
    await page.goto('/');
    const button = hotkeysButton(page);
    await expect(button).toHaveAttribute('title', 'Горячие клавиши (?)');
    // D-261: клавиша объявлена и экранному диктору — значением KeyboardEvent.key.
    await expect(button).toHaveAttribute('aria-keyshortcuts', '?');
    // Из левой колонки кнопка ушла, «Обучение» осталось на месте.
    await expect(page.locator('.shell__side').getByRole('button', { name: /Горячие клавиши/ })).toHaveCount(0);
    await expect(page.locator('.shell__side-foot').getByRole('button', { name: 'Обучение' })).toBeVisible();
    await button.click();
    await expect(dialog(page)).toBeVisible();

    // Пока накладка открыта, подложка (D-195) забирает мышь у всего, что под
    // ней, включая саму кнопку — закрывает крестик внутри диалога.
    await dialog(page).getByRole('button', { name: 'Закрыть' }).click();
    await expect(dialog(page)).toHaveCount(0);
  });

  test('после закрытия фокус возвращается на кнопку, которой открыли', async ({ page }) => {
    await page.goto('/');
    const button = hotkeysButton(page);
    await button.focus();
    await button.press('Enter');
    await expect(dialog(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(button).toBeFocused();
  });

  test('? в поле карточки правит текст, накладка не открывается', async ({ page }) => {
    await page.goto('/');
    await placeFromLibrary(page, RACK, 420, 330);
    // После #222 вкладки скрыты, пока объект выделен: снимаем выделение.
    await page.keyboard.press('Escape');
    await showTab(page, 'Инвентаризация');
    await page.getByLabel('Инвентаризация').locator('table').first().locator('tbody tr').first().getByRole('button').first().click();

    const name = page.getByLabel('Свойства').getByLabel('Название');
    await name.click();
    await name.press('End');
    await name.press('Shift+Slash');

    await expect(dialog(page)).toHaveCount(0);
  });

  test('Delete не проходит к плану, пока открыта накладка', async ({ page }) => {
    await page.goto('/');
    await placeFromLibrary(page, RACK, 420, 330);
    await page.keyboard.press('Escape'); // #222: вкладки скрыты при выделении
    await selectRow(page, 0);
    await expect(inventoryRows(page)).toHaveCount(1);

    await page.keyboard.press('Shift+Slash');
    await expect(dialog(page)).toBeVisible();

    await page.keyboard.press('Delete');
    await expect(dialog(page)).toBeVisible();
    // Объект жив, пока накладка на экране, а не только после её закрытия.
    await expect(inventoryRows(page)).toHaveCount(1);

    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(inventoryRows(page)).toHaveCount(1);
  });

  test('Tab не выпускает фокус за пределы диалога', async ({ page }) => {
    await page.goto('/');
    const opener = hotkeysButton(page);
    await opener.click();
    await expect(dialog(page)).toBeVisible();
    // Открытие фокусирует сам диалог (D-195), единственная кнопка внутри — крестик.
    await expect(dialog(page)).toBeFocused();

    const closeButton = dialog(page).getByRole('button', { name: 'Закрыть' });
    await page.keyboard.press('Tab');
    await expect(closeButton).toBeFocused();
    await expect(opener).not.toBeFocused();

    // Второй Tab не выпускает наружу — единственный фокусируемый узел держит фокус на себе.
    await page.keyboard.press('Tab');
    await expect(closeButton).toBeFocused();
    await expect(opener).not.toBeFocused();

    await page.keyboard.press('Shift+Tab');
    await expect(closeButton).toBeFocused();
    await expect(opener).not.toBeFocused();
  });

  test('каждая клавиша — отдельный блок, имя сочетания читается целиком, всё помещается на 1280×720', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    await hotkeysButton(page).click();
    await expect(dialog(page)).toBeVisible();

    const redo = dialog(page).getByLabel('Ctrl+Shift+Z или Ctrl+Y', { exact: true });
    await expect(redo.locator('kbd')).toHaveText(['Ctrl', 'Shift', 'Z', 'Ctrl', 'Y']);
    await expect(redo.locator('.hotkeys-map__plus')).toHaveCount(3);
    for (const plus of await redo.locator('.hotkeys-map__plus').all()) {
      await expect(plus).toHaveAttribute('aria-hidden', 'true');
    }
    await expect(redo.getByText('или', { exact: true })).toBeVisible();
    await expect(dialog(page).getByLabel('↑ ↓ ← →', { exact: true }).locator('kbd')).toHaveCount(4);
    await expect(dialog(page).getByLabel('Ctrl+C затем Ctrl+V', { exact: true }).getByText('затем')).toBeVisible();

    // Однобуквенные клавиши — одной высоты и не уже минимальной ширины.
    const single = await dialog(page).getByLabel('F', { exact: true }).locator('kbd').boundingBox();
    const wide = await dialog(page).getByLabel('Enter', { exact: true }).locator('kbd').boundingBox();
    expect(single!.width).toBeGreaterThanOrEqual(24);
    expect(single!.height).toBe(wide!.height);

    // Колонка клавиш одной ширины: описания всех строк начинаются с одного x внутри колонки групп.
    const descriptions = dialog(page).locator('.hotkeys-map__description');
    const lefts = new Set<number>();
    for (const box of await descriptions.evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().left)))) {
      lefts.add(box);
    }
    expect(lefts.size).toBeLessThanOrEqual(2);

    // Без горизонтального скролла и без обрезки по высоте окна.
    const metrics = await dialog(page).evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, top: rect.top, bottom: rect.bottom, right: rect.right, left: rect.left };
    });
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
    expect(metrics.top).toBeGreaterThanOrEqual(0);
    expect(metrics.left).toBeGreaterThanOrEqual(0);
    expect(metrics.bottom).toBeLessThanOrEqual(720);
    expect(metrics.right).toBeLessThanOrEqual(1280);

    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
  });
});
