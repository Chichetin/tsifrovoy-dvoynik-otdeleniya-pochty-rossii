import { readFileSync } from 'node:fs';
import { test, expect, exportPlan } from './fixtures';

test('новый внешний контур не заменяет стены до явного применения', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByTestId('editor-canvas')).toBeVisible();
  const draw = async (width: number) => {
    await page.getByRole('button', { name: 'Выбор', exact: true }).click();
    await page.getByRole('button', { name: 'Помещение', exact: true }).click();
    const box = await page.locator('.editor-canvas canvas').first().boundingBox();
    if (!box) throw new Error('Нет холста');
    await page.keyboard.down('Alt');
    for (const [x, y] of [[60, 240], [width, 240], [width, 550], [60, 550]]) {
      await page.mouse.click(box.x + x!, box.y + y!);
    }
    await page.keyboard.up('Alt');
    await page.getByRole('button', { name: 'Завершить помещение', exact: true }).click();
  };
  const save = async () => {
    const download = page.waitForEvent('download');
    await exportPlan(page, 'JSON');
    const file = await download;
    return JSON.parse(readFileSync((await file.path())!, 'utf8')) as { room: unknown; walls: unknown[] };
  };
  const original = await save();
  await draw(350);
  const apply = page.getByRole('button', { name: 'Применить внешний контур', exact: true });
  await expect(apply).toBeVisible();
  await page.getByRole('button', { name: 'Помещение', exact: true }).focus();
  await page.keyboard.press('Enter');
  expect((await save()).walls).toEqual(original.walls);
  await page.getByRole('button', { name: 'Отменить рисование', exact: true }).click();
  expect((await save()).room).toEqual(original.room);
  await draw(350);
  await apply.click();
  const changed = await save();
  expect(changed.room).not.toEqual(original.room);
  await page.keyboard.press('Control+z');
  expect((await save()).walls).toEqual(original.walls);
});
