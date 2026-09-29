import { readFileSync } from 'node:fs';
import { test, expect, exportPlan, type Page } from './fixtures';

async function save(page: Page): Promise<{ zones: { polygon: number[][] }[] }> {
  const pending = page.waitForEvent('download');
  await exportPlan(page, 'JSON');
  const file = await pending;
  return JSON.parse(readFileSync((await file.path())!, 'utf8')) as { zones: { polygon: number[][] }[] };
}

for (const width of [1280, 1440]) {
  test(`зона по видимым действиям: исправить, завершить, отменить — ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1280 ? 800 : 900 });
    await page.goto('/');
    await expect(page.getByTestId('editor-canvas')).toBeVisible();
    const click = async (x: number, y: number) => {
      const box = await page.locator('.editor-canvas canvas').first().boundingBox();
      if (box === null) throw new Error('Нет холста');
      await page.keyboard.down('Alt');
      await page.mouse.click(box.x + x, box.y + y);
      await page.keyboard.up('Alt');
    };
    await page.getByRole('button', { name: 'Помещение', exact: true }).click();
    for (const [x, y] of [[60, 240], [500, 240], [500, 550], [60, 550]]) await click(x!, y!);
    await page.getByRole('button', { name: 'Завершить помещение', exact: true }).click();
    await page.getByRole('button', { name: 'Зона', exact: true }).click();
    const controls = page.getByRole('region', { name: 'Рисование контура' });
    await expect(controls).toContainText('Нажмите первый угол');
    await expect(controls.getByRole('button', { name: 'Завершить зону' })).toBeDisabled();
    for (const [x, y] of [[120, 320], [360, 320], [120, 480], [360, 480]]) await click(x!, y!);
    await controls.getByRole('button', { name: 'Завершить зону' }).click();
    await expect(controls).toContainText('Контур самопересекается');
    expect((await save(page)).zones).toHaveLength(0);
    await page.screenshot({ path: `docs/verification/2026-09-29-zone-drawing-${width}.png` });
    await controls.getByRole('button', { name: 'Убрать последний угол' }).focus();
    await page.keyboard.press('Enter');
    await expect(controls).toContainText('Углов: 3');
    expect((await save(page)).zones).toHaveLength(0);
    await controls.getByRole('button', { name: 'Завершить зону' }).click();
    const saved = await save(page);
    expect(saved.zones).toHaveLength(1);
    expect(saved.zones[0]?.polygon).toHaveLength(3);
    await page.keyboard.press('Control+z');
    expect((await save(page)).zones).toHaveLength(0);
    await click(180, 360);
    await controls.getByRole('button', { name: 'Отменить рисование', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(controls).not.toBeVisible();
    expect((await save(page)).zones).toHaveLength(0);
  });
}
