/**
 * D-351: «Настройки» модальны к клавиатуре. Esc закрывает окно и ничего не
 * делает с планом за ним: холст слушает Esc на window в capture-фазе раньше
 * окна и без проверки снимал бы выделение.
 */

import { expect, test } from './fixtures';
import { openSettings, settingsDialog } from './settings';

test('Esc в окне закрывает его, выделение на плане остаётся', async ({ page }) => {
  await page.goto('/');
  const card = page.getByLabel('Свойства');
  // Помещение выбирается кликом по полу.
  await page.getByTestId('editor-canvas').click({ position: { x: 300, y: 200 } });
  await expect(card).toHaveAttribute('data-entity-id', 'room_main');

  const dialog = await openSettings(page, 'Оборудование');
  await dialog.getByRole('button', { name: 'Оборудование', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(settingsDialog(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Настройки', exact: true })).toBeFocused();
  await expect(card).toHaveAttribute('data-entity-id', 'room_main');
});
