/**
 * D-273: сообщения об ошибках не висят вечно. Плашка «Правка отклонена» над
 * холстом и ошибка файла в строке под шапкой закрываются крестиком «Скрыть
 * сообщение» и пропадают сами, когда план, о котором они говорили, изменился:
 * успешная правка, «Отменить», другой документ.
 */

import { join } from 'node:path';
import { expect, test, type Page } from './fixtures';
import { showTab } from './side-tabs';

const DEMO = join(process.cwd(), 'demo', 'before.json');
const plaque = (page: Page) => page.locator('.shell__error');
const lockBase = (page: Page) => page.getByRole('button', { name: 'Запереть слой Основной' });

/** Демо, первый объект перечня выбран, слой «Основной» заперт, Delete отклонён. */
async function refuseDelete(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('plan-file-input').setInputFiles(DEMO);
  await expect(page.getByTestId('files-notice')).toContainText('открыт');
  await showTab(page, 'Инвентаризация');
  const rows = page.getByLabel('Инвентаризация').locator('table').first().locator('tbody tr');
  await rows.first().getByRole('button').first().click();
  await showTab(page, 'Слои');
  await lockBase(page).click();
  await page.keyboard.press('Delete');
  await expect(plaque(page)).toHaveAttribute('role', 'alert');
  await expect(plaque(page)).toContainText('Правка отклонена');
  await expect(plaque(page)).toContainText('заперт');
}

test('крестик «Скрыть сообщение» убирает плашку отклонённой правки', async ({ page }) => {
  await refuseDelete(page);
  const close = plaque(page).getByRole('button', { name: 'Скрыть сообщение' });
  // Плашка по-прежнему не ловит клики по плану, крестик — ловит.
  await expect(plaque(page)).toHaveCSS('pointer-events', 'none');
  await expect(close).toHaveCSS('pointer-events', 'auto');
  await close.click();
  await expect(plaque(page)).toHaveCount(0);
});

test('крестик доступен с клавиатуры: Enter на нём убирает плашку', async ({ page }) => {
  await refuseDelete(page);
  const close = plaque(page).getByRole('button', { name: 'Скрыть сообщение' });
  await close.focus();
  await page.keyboard.press('Enter');
  await expect(plaque(page)).toHaveCount(0);
});

test('успешная правка снимает плашку сама: замок снят — отказ больше не про этот план', async ({ page }) => {
  await refuseDelete(page);
  await showTab(page, 'Слои');
  await lockBase(page).click();
  await expect(plaque(page)).toHaveCount(0);
});

test('«Отменить» снимает плашку сама: документ вернулся к другой ревизии', async ({ page }) => {
  await refuseDelete(page);
  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect(plaque(page)).toHaveCount(0);
  // Отменённый замок: тот же Delete теперь удаляет, и новой плашки нет.
  await expect(lockBase(page)).toHaveAttribute('aria-pressed', 'false');
});

test('ошибка файла под шапкой закрывается крестиком и пропадает после правки плана', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('plan-file-input').setInputFiles(DEMO);
  await expect(page.getByTestId('files-notice')).toContainText('открыт');
  page.on('dialog', (dialog) => void dialog.accept());
  const broken = { name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion": 1, "zones": [') };
  const fileError = page.locator('.files__error');

  await page.getByTestId('plan-file-input').setInputFiles(broken);
  await expect(fileError).toContainText('План не открыт');
  await fileError.getByRole('button', { name: 'Скрыть сообщение' }).click();
  await expect(fileError).toHaveCount(0);
  await expect(page.getByTestId('file-error-details')).toHaveCount(0);

  await page.getByTestId('plan-file-input').setInputFiles(broken);
  await expect(fileError).toContainText('План не открыт');
  await showTab(page, 'Слои');
  await lockBase(page).click();
  await expect(fileError).toHaveCount(0);
});
