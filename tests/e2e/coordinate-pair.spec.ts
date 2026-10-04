import { readFileSync, writeFileSync } from 'node:fs';
import type { PlanDocument } from '../../src/contracts/model';
import { expandInventoryRows } from './inventory-collapse';
import { expect, exportPlan, test } from './fixtures';

const before = JSON.parse(readFileSync('demo/before.json', 'utf8')) as PlanDocument;
const after = JSON.parse(readFileSync('demo/after.json', 'utf8')) as PlanDocument;

for (const width of [1280, 1440]) {
  test(`X/Y одной командой: отказ, клавиатура, история и файл (${width})`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 1280 ? 800 : 900 });
    const bench = after.objects.find((object) => object.id === 'eq_54')!;
    const initial = { ...before, objects: [...before.objects, { ...bench, position: [7.5, 1] }] };
    const file = testInfo.outputPath('initial.json');
    writeFileSync(file, JSON.stringify(initial));
    await page.goto('/');
    await page.getByTestId('plan-file-input').setInputFiles(file);
    await expandInventoryRows(page);
    await page.getByLabel('Инвентаризация', { exact: true }).locator('tbody tr').filter({ hasText: bench.label }).getByRole('button').first().click();
    const card = page.getByLabel('Свойства', { exact: true });
    await expect(card).toHaveAttribute('data-entity-id', bench.id);
    const x = card.getByLabel('X, м');
    const y = card.getByLabel('Y, м');
    const apply = card.getByRole('button', { name: 'Применить координаты' });
    await x.fill('2.2');
    await apply.click();
    await expect(card.getByRole('alert')).toContainText('занимают одно место');
    await expect(x).toHaveValue('2.2');
    await y.fill('2');
    await y.press('Enter');
    await expect(card.getByRole('alert')).toHaveCount(0);
    await expect(card.getByTestId('props-zone')).toHaveText('Зона: Зона ожидания');
    await page.getByRole('button', { name: 'Отменить', exact: true }).click();
    await expect(x).toHaveValue('7.5');
    await expect(y).toHaveValue('1');
    await page.getByRole('button', { name: 'Вернуть', exact: true }).click();
    await expect(x).toHaveValue('2.2');
    await expect(y).toHaveValue('2');
    await x.fill('');
    await expect(x).toHaveAttribute('aria-invalid', 'true');
    await expect(card.getByRole('alert')).toContainText('Нужно число');
    await x.press('Escape');
    await expect(x).toHaveValue('2.2');
    await expect(card).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download'), exportPlan(page, 'JSON')]);
    const saved = testInfo.outputPath('coordinates.json');
    await download.saveAs(saved);
    const decoded = JSON.parse(readFileSync(saved, 'utf8'));
    const moved = decoded.objects.find((object: { id: string }) => object.id === bench.id);
    expect(moved).toMatchObject({ id: bench.id, position: [2.2, 2], zoneId: 'z_waiting', attributes: bench.attributes });
    await page.getByTestId('plan-file-input').setInputFiles(saved);
    await expandInventoryRows(page);
    await page.getByLabel('Инвентаризация', { exact: true }).locator('tbody tr').filter({ hasText: bench.label }).getByRole('button').first().click();
    await expect(x).toHaveValue('2.2');
    await expect(y).toHaveValue('2');
    // The form remains usable at the panel's minimum width.
    const separator = page.getByRole('separator', { name: /левой/i });
    await separator.focus();
    await separator.press('Home');
    for (const control of [x, y, apply]) {
      const bounds = await control.boundingBox();
      const panel = await card.boundingBox();
      expect(bounds).not.toBeNull();
      expect(panel).not.toBeNull();
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(panel!.x + panel!.width + 1);
    }
    await card.screenshot({ path: testInfo.outputPath('coordinates-after.png') });
  });
}
