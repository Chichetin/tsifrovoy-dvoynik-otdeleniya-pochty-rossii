/**
 * D-250: название зоны на холсте окрашено по уровню вложенности — корень,
 * вложенная, вложенная во вложенную. Проверяется по узлам Konva
 * (`window.Konva`), то есть по тому, что нарисовано, а не по расчёту теста.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from './fixtures';

/** `fill` подписи каждой зоны на сцене: id зоны → цвет. */
async function nameFills(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    type Node = { id(): string; fill(): string };
    type KonvaGlobal = { stages: { find(selector: string): Node[] }[] };
    const konva = (window as unknown as { Konva?: KonvaGlobal }).Konva;
    const nodes = konva?.stages[0]?.find('.zone-name') ?? [];
    return Object.fromEntries(nodes.map((node) => [node.id().replace(/^zone-name-/, ''), node.fill()]));
  });
}

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/');
  await expect(page.locator('.editor-canvas canvas').first()).toBeVisible();
});

test('демо-план: корневые зоны одного цвета, вложенные в клиентский зал — другого', async ({ page }) => {
  await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'demo', 'before.json'));
  await expect.poll(async () => Object.keys(await nameFills(page)).length).toBe(8);
  const fills = await nameFills(page);

  expect(fills.z_back).toBe(fills.z_client);
  expect(fills.z_staff).toBe(fills.z_client);
  expect(fills.z_waiting).toBe(fills.z_entrance);
  expect(fills.z_queue).toBe(fills.z_entrance);
  expect(fills.z_waiting).not.toBe(fills.z_client);
});

test('пример организаторов: ожидание и очередь, вложенные в зал по геометрии, отличаются от зала', async ({
  page,
}) => {
  // В примере вложенность не записана: `parentId` выводит импорт по геометрии.
  // z_waiting и z_queue — соседи внутри z_client, служебная z_back — корень.
  await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'example_plan.json'));
  await expect.poll(async () => Object.keys(await nameFills(page)).length).toBe(4);
  const fills = await nameFills(page);

  expect(fills.z_back).toBe(fills.z_client);
  expect(fills.z_queue).toBe(fills.z_waiting);
  expect(fills.z_waiting).not.toBe(fills.z_client);
});

test('третий уровень: зона внутри «Зоны очереди» получает третий цвет, а не повтор первых двух', async ({ page }) => {
  const plan = JSON.parse(readFileSync(join(process.cwd(), 'demo', 'before.json'), 'utf8')) as {
    id: string;
    zones: Record<string, unknown>[];
  };
  const queue = plan.zones.find((zone) => zone.id === 'z_queue');
  if (queue === undefined) throw new Error('В демо-плане нет z_queue');
  plan.id = 'plan_zone_names_depth';
  plan.zones.push({
    ...queue,
    id: 'z_queue_head',
    name: 'Голова очереди',
    polygon: [
      [5.2, 2.8],
      [6.4, 2.8],
      [6.4, 4.4],
      [5.2, 4.4],
    ],
    parentId: 'z_queue',
  });
  await page.getByTestId('plan-file-input').setInputFiles({
    name: 'depth.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(plan)),
  });
  await expect.poll(async () => Object.keys(await nameFills(page)).length).toBe(9);
  const fills = await nameFills(page);

  const levels = [fills.z_client, fills.z_queue, fills.z_queue_head];
  expect(levels.every((fill) => typeof fill === 'string')).toBe(true);
  expect(new Set(levels).size).toBe(3);
});
