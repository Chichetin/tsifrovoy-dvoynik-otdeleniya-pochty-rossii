import { readFileSync } from 'node:fs';
import { test, expect, exportPlan, passPhysicsBlock } from './fixtures';

test.use({ launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } });
test('углы стен замкнуты в 2D и загружаются в 3D', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const canvas = page.getByTestId('editor-canvas');
  await expect(canvas).toBeVisible();
  const box = await page.locator('.editor-canvas canvas').first().boundingBox();
  if (!box) throw new Error('Нет холста');
  const visible = (await canvas.getAttribute('data-visible'))!.split(',').map(Number);
  const polygons = await page.evaluate(() => {
    type Shape = { fill(): string; closed(): boolean; points(): number[]; getClassName(): string };
    type Stage = { find(selector: string): Shape[] };
    const stage = (window as unknown as { Konva: { stages: Stage[] } }).Konva.stages[0]!;
    return stage.find('Line').filter((node) => node.getClassName() === 'Line' && node.fill() === '#495057' && node.closed()).map((node) => node.points());
  });
  expect(polygons).toHaveLength(4);
  const world = polygons.map((polygon) => polygon.reduce<number[][]>((points, _, index) => {
    if (index % 2 === 0) points.push([visible[0]! + polygon[index]! / box.width * (visible[2]! - visible[0]!), visible[3]! - polygon[index + 1]! / box.height * (visible[3]! - visible[1]!)]);
    return points;
  }, []));
  // data-visible publishes metres rounded to 0.001; inverse screen conversion shares that precision.
  const sharedCorner = world.flat().filter(([x, y]) => Math.abs(x! + 0.125) < 0.001 && Math.abs(y! + 0.125) < 0.001);
  expect(sharedCorner).toHaveLength(2);
  if (process.env.UPDATE_SNAPSHOTS === '1') await page.screenshot({ path: 'docs/verification/2026-10-01-wall-joints-2d.png' });
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.locator('.view3d canvas')).toBeVisible();
  await expect(page.getByTestId('view3d-error')).toHaveCount(0);
  if (process.env.UPDATE_SNAPSHOTS === '1') await page.screenshot({ path: 'docs/verification/2026-10-01-wall-joints-3d.png' });
});

test('оба демо используют ровные Т-стыки в 2D/3D и сохраняют исходные стены', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/');
  for (const [variant, name] of [['before', 'Исходный демо-план'], ['after', 'Изменённый демо-план']] as const) {
    await page.getByRole('button', { name: '2D', exact: true }).click();
    await page.getByRole('button', { name: 'Демо', exact: true }).click();
    await page.getByRole('menuitem', { name }).click();
    await expect(page.getByTestId('files-notice')).toContainText('учебное отделение');
    const canvas = page.getByTestId('editor-canvas');
    const box = await page.locator('.editor-canvas canvas').first().boundingBox();
    if (!box) throw new Error('Нет холста');
    const visible = (await canvas.getAttribute('data-visible'))!.split(',').map(Number);
    const points = await page.evaluate(() => {
      type Shape = { fill(): string; closed(): boolean; points(): number[] };
      type Stage = { find(selector: string): Shape[] };
      const stage = (window as unknown as { Konva: { stages: Stage[] } }).Konva.stages[0]!;
      return stage.find('Line').filter((node) => node.fill() === '#495057' && node.closed()).flatMap((node) => {
        const values = node.points();
        return values.filter((_, index) => index % 2 === 0).map((x, index) => [x, values[index * 2 + 1]!] as const);
      });
    });
    // Storage partition meets the east wall's face at x=15-0.25/2.
    expect(points.some(([x, y]) =>
      Math.abs(visible[0]! + x / box.width * (visible[2]! - visible[0]!) - 14.875) < 0.002
      && Math.abs(visible[3]! - y / box.height * (visible[3]! - visible[1]!) - 6.325) < 0.002)).toBe(true);
    const downloaded = page.waitForEvent('download');
    await exportPlan(page, 'JSON');
    await passPhysicsBlock(page);
    const path = await (await downloaded).path();
    expect(JSON.parse(readFileSync(path!, 'utf8'))).toEqual(JSON.parse(readFileSync(`demo/${variant}.json`, 'utf8')));
    await page.getByTestId('plan-file-input').setInputFiles(path!);
    await expect(page.getByTestId('files-notice')).toContainText('учебное отделение');
    if (variant === 'before' && process.env.SAVE_T_JOINT_SNAPSHOTS === '1') {
      await page.screenshot({ path: 'docs/verification/2026-10-02-demo-t-joints-2d.png' });
    }
    await page.getByRole('button', { name: '3D', exact: true }).click();
    await expect(page.locator('.view3d canvas')).toBeVisible();
    await expect(page.getByTestId('view3d-error')).toHaveCount(0);
    if (variant === 'before' && process.env.SAVE_T_JOINT_SNAPSHOTS === '1') {
      await page.screenshot({ path: 'docs/verification/2026-10-02-demo-t-joints-3d.png' });
    }
  }
});
