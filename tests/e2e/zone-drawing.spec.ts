import { readFileSync } from 'node:fs';
import { test, expect, exportPlan, type Page } from './fixtures';

async function save(page: Page): Promise<{ zones: { polygon: number[][] }[] } & { path: string }> {
  const pending = page.waitForEvent('download');
  await exportPlan(page, 'JSON');
  const file = await pending;
  const path = (await file.path())!;
  const json = JSON.parse(readFileSync(path, 'utf8')) as { zones: { polygon: number[][] }[] };
  return { ...json, path };
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
    await page.getByRole('radio', { name: 'Изменить внешний контур' }).check();
    for (const [x, y] of [[60, 240], [500, 240], [500, 550], [60, 550]]) await click(x!, y!);
    await page.getByRole('button', { name: 'Завершить помещение', exact: true }).click();
    await page.getByRole('button', { name: 'Применить внешний контур', exact: true }).click();
    await page.getByRole('button', { name: 'Зона', exact: true }).click();
    const controls = page.getByRole('region', { name: 'Рисование контура' });
    await expect(controls).toContainText('Нажмите первый угол');
    await expect(controls.getByRole('button', { name: 'Завершить зону' })).toBeDisabled();
    for (const [x, y] of [[120, 320], [360, 320], [120, 480], [360, 480]]) await click(x!, y!);
    await controls.getByRole('button', { name: 'Завершить зону' }).click();
    await expect(controls).toContainText('Контур самопересекается');
    expect((await save(page)).zones).toHaveLength(0);
    // Снимок закоммичен в docs/verification: обычный прогон его не перезаписывает,
    // обновление — по явному запросу (см. validation.spec.ts, D-315).
    if (process.env['UPDATE_SNAPSHOTS'] === '1') {
      await page.screenshot({ path: `docs/verification/2026-09-29-zone-drawing-${width}.png` });
    }
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

// #43, п. 1 ревью: docs/verification заявлял «JSON → повторное открытие →
// совпадение polygon», а спека раньше только экспортировала и считала зоны.
// Проверяется, что открытый заново экспорт даёт тот же контур, что и до сохранения
// (как round-trip.spec.ts для объектов).
test('зона по видимым действиям переживает файл: JSON → повторное открытие → тот же контур', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
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
    await page.getByRole('radio', { name: 'Изменить внешний контур' }).check();
  for (const [x, y] of [[60, 240], [500, 240], [500, 550], [60, 550]]) await click(x!, y!);
  await page.getByRole('button', { name: 'Завершить помещение', exact: true }).click();
    await page.getByRole('button', { name: 'Применить внешний контур', exact: true }).click();
  await page.getByRole('button', { name: 'Зона', exact: true }).click();
  const controls = page.getByRole('region', { name: 'Рисование контура' });
  for (const [x, y] of [[120, 320], [360, 320], [360, 480]]) await click(x!, y!);
  await controls.getByRole('button', { name: 'Завершить зону' }).click();

  const saved = await save(page);
  expect(saved.zones).toHaveLength(1);
  const polygon = saved.zones[0]?.polygon;
  expect(polygon).toHaveLength(3);

  await page.reload();
  await page.getByTestId('plan-file-input').setInputFiles(saved.path);
  await expect(page.getByTestId('editor-canvas')).toBeVisible();

  const reopened = await save(page);
  expect(reopened.zones).toHaveLength(1);
  // Тот же контур, не просто то же число углов: id, порядок и координаты вершин.
  expect(reopened.zones[0]?.polygon).toEqual(polygon);
});
