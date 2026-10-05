/**
 * D-312 в браузере: предмет без инвентарного номера виден в «Проверке».
 *
 * Демо-план открывается без такой находки — у всех 53 объектов есть номер.
 * Копия (Ctrl+C/Ctrl+V) номер не наследует (D-266), и «Проверка» сразу
 * называет её по имени; ссылка находки ведёт к копии, а вписанный номер
 * снимает находку.
 */

import { join } from 'node:path';
import { expect, test, type Page } from './fixtures';
import { expandInventoryRows } from './inventory-collapse';
import { showTab } from './side-tabs';

test.use({ viewport: { width: 1440, height: 900 } });

const card = (page: Page) => page.getByLabel('Свойства');
const inventoryRows = (page: Page) =>
  page.getByLabel('Инвентаризация').locator('table').first().locator('tbody tr');

test('копия без номера — предупреждение с названием, ссылкой на копию и снятием по номеру', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'demo', 'before.json'));
  await expect(inventoryRows(page)).toHaveCount(53);

  const validation = page.getByLabel('Проверка плана');
  const missing = validation.locator('.issues__item', { hasText: 'нет инвентарного номера' });
  await showTab(page, 'Проверка');
  await expect(validation).toBeVisible();
  await expect(missing).toHaveCount(0);

  await showTab(page, 'Инвентаризация');
  await expandInventoryRows(page);
  await inventoryRows(page).first().getByRole('button').first().click();
  await expect(card(page)).toHaveAttribute('data-entity-id', 'eq_1');
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await expect(inventoryRows(page)).toHaveCount(54);
  await expect(card(page)).toHaveAttribute('data-entity-id', 'eq_54');

  await showTab(page, 'Проверка');
  await expect(missing).toHaveCount(1);
  // Копия терминала стоит дальше 3 м от входа: находки одного объекта идут одной группой (#14),
  // и строка называется по самой тяжёлой из них.
  await expect(missing).toHaveClass(/is-(warning|error)/);
  await expect(
    missing.getByText(
      'У объекта «Терминал электронной очереди» нет инвентарного номера: впишите номер с ярлыка предмета в карточке.',
    ),
  ).toBeVisible();
  const ref = missing.getByRole('button', { name: 'Терминал электронной очереди' });
  await expect(ref).toHaveAttribute('data-ref-id', 'eq_54');
  // The committed snapshot is refreshed on request only, so an ordinary run
  // does not rewrite a tracked file: UPDATE_SNAPSHOTS=1 npx playwright test …
  await missing.scrollIntoViewIfNeeded();
  if (process.env['UPDATE_SNAPSHOTS'] === '1') {
    await page.screenshot({
      path: 'docs/verification/2026-09-29-inventory-number/missing-number-finding.png',
      clip: (await missing.boundingBox()) ?? undefined,
    });
  }

  // Ссылка — клавиатурой: фокус на кнопке, Enter выбирает копию.
  await ref.focus();
  await page.keyboard.press('Enter');
  await expect(card(page)).toHaveAttribute('data-entity-id', 'eq_54');

  await card(page).getByLabel('Инвентарный номер').fill('ИНВ-ДЕМО-054');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await showTab(page, 'Проверка');
  await expect(missing).toHaveCount(0);
  expect(errors).toEqual([]);
});
