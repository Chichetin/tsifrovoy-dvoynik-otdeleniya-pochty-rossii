import { test, expect } from './fixtures';

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
