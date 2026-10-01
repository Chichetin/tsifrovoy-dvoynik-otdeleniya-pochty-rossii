import { readFileSync } from 'node:fs';
import { test, expect, exportPlan } from './fixtures';
import type { PlanDocument } from '../../src/contracts/model';

test('две пристыкованные комнаты сохраняют наружные стены, проём и JSON; пересечение не применяется', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByTestId('editor-canvas')).toBeVisible();
  const save = async () => {
    const pending = page.waitForEvent('download'); await exportPlan(page, 'JSON');
    const file = await pending; const path = (await file.path())!;
    return { document: JSON.parse(readFileSync(path, 'utf8')) as PlanDocument, path };
  };
  const click = async (x: number, y: number) => {
    const box = await page.locator('.editor-canvas canvas').first().boundingBox();
    const visible = (await page.getByTestId('editor-canvas').getAttribute('data-visible'))!.split(',').map(Number);
    if (!box) throw new Error('Нет холста');
    await page.mouse.click(box.x + (x - visible[0]!) / (visible[2]! - visible[0]!) * box.width,
      box.y + (visible[3]! - y) / (visible[3]! - visible[1]!) * box.height);
  };
  const original = (await save()).document;
  await page.getByRole('button', { name: 'Помещение', exact: true }).click();
  const controls = page.getByRole('region', { name: 'Создание комнаты' });
  await expect(controls).toContainText('Нажмите первый угол');
  await click(0.04, 0.04); await click(4, 4);
  await expect(controls.getByRole('button', { name: 'Создать комнату' })).toBeEnabled();
  expect((await save()).document.walls).toEqual(original.walls);
  await controls.getByRole('button', { name: 'Создать комнату' }).click();
  const first = (await save()).document;
  expect(first.walls).toHaveLength(original.walls.length + 2);
  expect(first.room).toEqual(original.room); expect(first.openings).toEqual(original.openings);
  await click(4, 0.04); await click(8, 4);
  await controls.getByRole('button', { name: 'Создать комнату' }).click();
  const second = await save();
  expect(second.document.walls).toHaveLength(original.walls.length + 4);
  expect(second.document.zones).toHaveLength(2);
  if (process.env.UPDATE_SNAPSHOTS === '1') await page.screenshot({ path: 'docs/verification/2026-10-01-internal-rooms.png' });
  await click(3, 1); await click(6, 5);
  await expect(controls).toContainText('пересекает существующую стену');
  await expect(controls.getByRole('button', { name: 'Создать комнату' })).toBeDisabled();
  expect((await save()).document.walls).toEqual(second.document.walls);
  await controls.getByRole('button', { name: 'Нарисовать заново' }).click();
  await page.keyboard.press('Control+z');
  expect((await save()).document.walls).toEqual(first.walls);
  await page.reload();
  await page.getByTestId('plan-file-input').setInputFiles(second.path);
  const reopened = (await save()).document;
  expect(reopened.walls).toEqual(second.document.walls); expect(reopened.zones).toEqual(second.document.zones);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.getByTestId('view3d')).toHaveAttribute('data-walls-count', String(second.document.walls.length));
  await expect(page.getByTestId('view3d-error')).toHaveCount(0);
});
