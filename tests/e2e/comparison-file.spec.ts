import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, exportPlan, expectUnsavedEdits, type Page } from './fixtures';
import { showTab } from './side-tabs';
import type { PlanDocument } from '../../src/contracts/model';
const after = JSON.parse(readFileSync(join(process.cwd(), 'demo/after.json'), 'utf8')) as PlanDocument;
const before = JSON.parse(readFileSync(join(process.cwd(), 'demo/before.json'), 'utf8')) as PlanDocument;

async function save(page: Page) {
  const pending = page.waitForEvent('download');
  await exportPlan(page, 'JSON');
  const download = await pending;
  const path = (await download.path())!;
  return { path, plan: JSON.parse(readFileSync(path, 'utf8')) as typeof after };
}

for (const width of [1280, 1440]) {
  test(`исходный файл сравнения сохраняет документ, dirty и undo — ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1280 ? 800 : 900 });
    page.on('dialog', (dialog) => void dialog.accept());
    await page.goto('/');
    await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'demo/after.json'));
    await showTab(page, 'Ассистент');
    await page.getByLabel('Сценарий').selectOption('compare');
    const panel = page.getByRole('region', { name: 'Сравнение планов', exact: true });
    await expect(panel).toContainText('В перечисленных элементах изменений нет.');
    await panel.getByTestId('comparison-file-input').setInputFiles(join(process.cwd(), 'demo/before.json'));
    await expect(panel).toContainText('before.json');
    await expect(panel.getByTestId('comparison-area.free')).toContainText('114,73');
    await expect(panel.getByTestId('comparison-area.free')).toContainText('113,93');
    await expect(panel.getByTestId('comparison-equipment.count')).toContainText('53');
    const errorRow = panel.getByTestId('comparison-issues.error');
    await expect(errorRow.locator('td').nth(0)).toHaveText('1');
    await expect(errorRow.locator('td').nth(1)).toHaveText('0');
    const warningRow = panel.getByTestId('comparison-issues.warning');
    await expect(warningRow.locator('td').nth(0)).toHaveText('1');
    await expect(warningRow.locator('td').nth(1)).toHaveText('0');
    await expect(panel).toContainText('Скамья ожидания 2');
    await expect(panel).toContainText('Терминал электронной очереди');
    // The committed snapshot is refreshed on request only, so an ordinary run
    // does not rewrite a tracked file: UPDATE_SNAPSHOTS=1 npx playwright test …
    if (process.env['UPDATE_SNAPSHOTS'] === '1') {
      await panel.screenshot({ path: `docs/verification/2026-09-29-comparison-file-${width}.png` });
    }
    const handle = page.getByRole('separator', { name: 'Изменить ширину правой панели' });
    await handle.focus();
    await page.keyboard.press('Home');
    await expect(handle).toHaveAttribute('aria-valuenow', '12.5');
    const table = panel.getByRole('region', { name: 'Показатели было и стало' });
    await expect(table.getByRole('columnheader', { name: 'Показатель', exact: true })).toHaveCount(1);
    await table.focus();
    expect(await table.evaluate((node) => node.scrollWidth)).toBeLessThanOrEqual(await table.evaluate((node) => node.clientWidth));
    await expect(panel.getByTestId('comparison-area.free')).toContainText('Свободно');
    await panel.locator('.comparison__changes').scrollIntoViewIfNeeded();
    if (process.env['UPDATE_SNAPSHOTS'] === '1') {
      await page.locator('#side-panel-right').screenshot({ path: `docs/verification/2026-09-29-comparison-file-${width}-compact.png` });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await handle.focus();
    await page.keyboard.press('End');
    await expectUnsavedEdits(page, false);
    expect((await save(page)).plan).toEqual(after);
    // Export changes the save baseline, but the explicitly chosen source stays.
    await expect(panel).toContainText('before.json');
    await showTab(page, 'Инвентаризация');
    const rows = page.getByLabel('Инвентаризация', { exact: true }).locator('table').first().locator('tbody tr');
    await rows.first().locator('.table__link').first().click();
    await page.keyboard.press('Delete');
    await expect(rows).toHaveCount(52);
    await showTab(page, 'Ассистент');
    await expect(panel.getByTestId('comparison-equipment.count')).toContainText('52');
    await panel.getByTestId('comparison-file-input').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
    await expect(panel.getByRole('alert')).toContainText('Файл не похож');
    await expect(panel).toContainText('before.json');
    await expectUnsavedEdits(page, true);
    // Changing the source is not an undo entry and cannot erase the edit history.
    await panel.getByTestId('comparison-file-input').setInputFiles(join(process.cwd(), 'demo/before.json'));
    await page.getByTestId('editor-canvas').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+z');
    expect((await save(page)).plan).toEqual(after);
    await panel.getByRole('button', { name: 'Сбросить исходный файл' }).click();
    await expect(panel).not.toContainText('before.json');
    await expect(panel).toContainText('В перечисленных элементах изменений нет.');
    await panel.getByTestId('comparison-file-input').setInputFiles(join(process.cwd(), 'demo/before.json'));
    const saved = await save(page);
    page.on('dialog', (dialog) => void dialog.accept());
    await page.getByTestId('plan-file-input').setInputFiles(saved.path);
    await expect(panel).not.toContainText('before.json');
    expect((await save(page)).plan).toEqual(after);
  });
}

test('посторонний документ показывает показатели, а не выдуманные переносы', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'demo/after.json'));
  await showTab(page, 'Ассистент');
  await page.getByLabel('Сценарий').selectOption('compare');
  const panel = page.getByRole('region', { name: 'Сравнение планов', exact: true });
  await panel.getByTestId('comparison-file-input').setInputFiles({ name: 'other.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...before, id: 'other-plan' })) });
  await expect(panel).toContainText('разные ID планов');
  await expect(panel).not.toContainText('Перемещено:');
  await expect(page.getByRole('button', { name: 'Спросить', exact: true })).toBeDisabled();
  expect((await save(page)).plan).toEqual(after);
});
