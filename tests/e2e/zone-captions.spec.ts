import { readFileSync } from 'node:fs';
import { test, expect, exportPlan, passPhysicsBlock, type Page } from './fixtures';

async function overlap(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    type Box = { x: number; y: number; width: number; height: number };
    type Node = { findOne(selector: string): Node; getClientRect(): Box };
    const stage = (window as unknown as { Konva: { stages: Node[] } }).Konva.stages[0]!;
    const a = stage.findOne('#zone-name-z_staff').getClientRect();
    const b = stage.findOne('.label-eq_50').getClientRect();
    return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  });
}

for (const width of [1280, 1440]) {
  test(`название комнаты персонала не перекрывает бирку дивана (${width})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Файл' }).click();
    await page.getByRole('menuitem', { name: 'Исходный демо-план' }).click();
    await expect(page.getByTestId('files-notice')).toContainText('учебное отделение');
    // Подписи объектов выключены по умолчанию (D-362): бирку дивана видно только с ними.
    await page.getByRole('button', { name: 'Подписи объектов' }).click();
    await expect.poll(() => overlap(page)).toBe(false);
    if (process.env.SAVE_ZONE_CAPTIONS === '1' && width === 1440) {
      await page.screenshot({ path: 'docs/verification/2026-10-02-zone-captions-accepted-1440.png' });
    }
    const box = await page.locator('.editor-canvas canvas').first().boundingBox();
    if (!box) throw new Error('Нет холста');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -300);
    await expect.poll(() => overlap(page)).toBe(false);
    await page.getByRole('tab', { name: 'Слои', exact: true }).click();
    await page.getByRole('button', { name: 'Показывать слой Тепловая нагрузка зон', exact: true }).click();
    await expect.poll(() => page.evaluate(() => {
      type Box = { x: number; y: number; width: number; height: number };
      type Node = { find(selector: string): Node[]; getClientRect(): Box };
      const stage = (window as unknown as { Konva: { stages: Node[] } }).Konva.stages[0]!;
      const names = stage.find('.zone-name').map((node) => node.getClientRect());
      const labels = stage.find('.info-label').map((node) => node.getClientRect());
      if (labels.length === 0) return -1;
      return labels.flatMap((a) => names.filter((b) =>
        a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height)).length;
    })).toBe(0);
    await page.getByRole('button', { name: 'Вписать', exact: true }).click();
    await expect.poll(() => overlap(page)).toBe(false);
    const plan = JSON.parse(readFileSync('demo/before.json', 'utf8'));
    plan.zones.find((zone: { id: string }) => zone.id === 'z_staff').name = 'ЗАЛ\n№1';
    await page.getByTestId('plan-file-input').setInputFiles({
      name: 'multiline-zone.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(plan)),
    });
    const drawnLines = () => page.evaluate(() => {
      type Node = { findOne(selector: string): Node; textArr: { text: string }[] };
      return (window as unknown as { Konva: { stages: Node[] } }).Konva.stages[0]!
        .findOne('#zone-name-z_staff').textArr.map((line) => line.text);
    });
    await expect.poll(drawnLines).toEqual(['ЗАЛ', '№1']);
    const downloading = page.waitForEvent('download');
    await exportPlan(page, 'JSON'); await passPhysicsBlock(page);
    const path = await (await downloading).path();
    expect(JSON.parse(readFileSync(path!, 'utf8'))).toEqual(plan);
    await page.getByTestId('plan-file-input').setInputFiles(path!);
    await expect.poll(drawnLines).toEqual(['ЗАЛ', '№1']);
  });
}
