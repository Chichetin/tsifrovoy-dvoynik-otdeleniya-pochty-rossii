/**
 * #35: the approval sheet on the demo pair. The e2e proves the numbers on it
 * are the same ones `comparison-file.spec.ts` checks in the table — this is
 * the same calculation, only laid out for printing — and that `@media print`
 * leaves exactly the sheet on the page.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { showTab } from './side-tabs';

const before = JSON.parse(readFileSync(join(process.cwd(), 'demo/before.json'), 'utf8')) as { id: string };

async function openSheet(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'demo/after.json'));
  await showTab(page, 'Ассистент');
  await page.getByLabel('Сценарий').selectOption('compare');
  const panel = page.getByRole('region', { name: 'Сравнение планов', exact: true });
  await panel.getByTestId('comparison-file-input').setInputFiles(join(process.cwd(), 'demo/before.json'));
  await expect(panel).toContainText('before.json');
  await panel.getByTestId('approval-sheet-open').click();
  return page.getByRole('dialog', { name: 'Лист согласования перепланировки' });
}

test('лист согласования показывает изменения по названиям и числа demo/effect.md', async ({ page }) => {
  const dialog = await openSheet(page);
  await expect(dialog).toBeVisible();

  // Обе картинки — реальный SVG-экспорт плана, не заглушка.
  await expect(dialog.getByTestId('approval-sheet-before').locator('svg')).toBeVisible();
  await expect(dialog.getByTestId('approval-sheet-after').locator('svg')).toBeVisible();

  // Штамп: план/отделение, источник «до», дата, пустой автор по умолчанию.
  await expect(dialog.getByTestId('approval-sheet-plan-name')).toHaveText('Демо-ОПС «Синтетическое» — учебное отделение');
  await expect(dialog.getByTestId('approval-sheet-before-source')).toHaveText('before.json');
  const author = dialog.getByTestId('approval-sheet-author');
  await expect(author).toHaveValue('');
  await author.fill('Иванова И. И., руководитель ОПС');
  await expect(author).toHaveValue('Иванова И. И., руководитель ОПС');

  // Эффект «было → стало» — те же числа, что demo/effect.md берёт из расчёта.
  const freeRow = dialog.getByTestId('approval-sheet-metric-area.free');
  await expect(freeRow.locator('td').nth(0)).toHaveText('114,73');
  await expect(freeRow.locator('td').nth(1)).toHaveText('113,93');
  await expect(dialog.getByTestId('approval-sheet-metric-equipment.count')).toContainText('53');
  const errorRow = dialog.getByTestId('approval-sheet-metric-issues.error');
  await expect(errorRow.locator('td').nth(0)).toHaveText('1');
  await expect(errorRow.locator('td').nth(1)).toHaveText('0');
  const warningRow = dialog.getByTestId('approval-sheet-metric-issues.warning');
  await expect(warningRow.locator('td').nth(0)).toHaveText('2');
  await expect(warningRow.locator('td').nth(1)).toHaveText('0');

  // Изменения — по названиям, id мелко рядом.
  const changes = dialog.getByTestId('approval-sheet-changes');
  await expect(changes).toContainText('Добавлен: Скамья ожидания 2');
  await expect(changes).toContainText('(eq_54)');
  await expect(changes).toContainText('Удалён: Табло над зоной очереди');
  await expect(changes).toContainText('(eq_8)');
  await expect(changes).toContainText('Перемещён: Терминал электронной очереди');
  await expect(changes).toContainText('(eq_1)');

  // Правила расчёта — с пометкой, что это решение команды, не норматив Почты.
  await expect(dialog.getByTestId('approval-sheet-assumptions')).not.toHaveCount(0);
  await expect(dialog).toContainText('не норматив Почты России');

  if (process.env['UPDATE_SNAPSHOTS'] === '1') {
    await dialog.screenshot({ path: 'docs/verification/2026-09-30-approval-sheet/sheet.png' });
  }
});

test('фокус: Tab не выпускает из окна, Escape закрывает без печати', async ({ page }) => {
  const dialog = await openSheet(page);
  await expect(dialog).toBeVisible();

  const print = dialog.getByTestId('approval-sheet-print');
  const close = dialog.getByTestId('approval-sheet-close');
  const author = dialog.getByTestId('approval-sheet-author');
  // Открытие фокусирует сам диалог, как карта горячих клавиш (D-195).
  await expect(dialog).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(print).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(author).toBeFocused();
  // Дальше в DOM фокусируемых нет: следующий Tab возвращает в начало.
  await page.keyboard.press('Tab');
  await expect(print).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(author).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('печать: @media print оставляет на странице только лист', async ({ page }) => {
  const dialog = await openSheet(page);
  await expect(dialog).toBeVisible();

  await page.emulateMedia({ media: 'print' });
  // Шапка приложения и панели скрыты — виден только лист.
  await expect(page.locator('.shell__bar')).toBeHidden();
  await expect(dialog.getByTestId('approval-sheet-print')).toBeHidden();
  await expect(dialog.getByTestId('approval-sheet-close')).toBeHidden();
  await expect(dialog.locator('.approval-sheet__page')).toBeVisible();
  await expect(dialog.getByTestId('approval-sheet-changes')).toBeVisible();

  if (process.env['UPDATE_SNAPSHOTS'] === '1') {
    await dialog.locator('.approval-sheet__page').screenshot({ path: 'docs/verification/2026-09-30-approval-sheet/print.png' });
  }

  await page.emulateMedia({ media: 'screen' });
  await expect(page.locator('.shell__bar')).toBeVisible();
});

test('несвязанные планы: предупреждение вместо перепутанных изменений', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'demo/after.json'));
  await showTab(page, 'Ассистент');
  await page.getByLabel('Сценарий').selectOption('compare');
  const panel = page.getByRole('region', { name: 'Сравнение планов', exact: true });
  await panel.getByTestId('comparison-file-input').setInputFiles({
    name: 'other.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...before, id: 'other-plan' })),
  });
  await expect(panel).toContainText('разные ID планов');
  await panel.getByTestId('approval-sheet-open').click();
  const dialog = page.getByRole('dialog', { name: 'Лист согласования перепланировки' });
  await expect(dialog).toContainText('разные ID планов');
  await expect(dialog.getByTestId('approval-sheet-changes')).toHaveCount(0);
});
