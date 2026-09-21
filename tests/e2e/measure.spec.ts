/**
 * D-256 в браузере: линейка меряет расстояние, подписи говорят настоящие длины
 * стен, и ни то ни другое не попадает в план.
 *
 * Нарисованное читается по узлам Konva (`window.Konva`), как в
 * `zone-names.spec.ts`: проверяется то, что видно на сцене, а не повтор
 * расчёта в тесте. Координаты мира переводятся в пиксели по числам, которые
 * холст публикует сам (`data-visible`, D-130), — арифметику вида тест не
 * дублирует.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from './fixtures';

type Pixel = { x: number; y: number };

async function stageRect(page: Page) {
  const box = await page.locator('.editor-canvas canvas').first().boundingBox();
  if (box === null) throw new Error('сцена не смонтирована');
  return box;
}

async function worldPixel(page: Page, x: number, y: number): Promise<Pixel> {
  const rect = await stageRect(page);
  const raw = await page.getByTestId('editor-canvas').getAttribute('data-visible');
  if (raw === null) throw new Error('холст не сообщил видимую область');
  const [minX, minY, maxX, maxY] = raw.split(',').map(Number) as [number, number, number, number];
  return {
    x: rect.x + ((x - minX) / (maxX - minX)) * rect.width,
    y: rect.y + ((maxY - y) / (maxY - minY)) * rect.height,
  };
}

async function clickWorld(page: Page, x: number, y: number): Promise<void> {
  const point = await worldPixel(page, x, y);
  await page.mouse.click(point.x, point.y);
}

/** Подпись линейки на сцене; `null` — линейки нет. */
async function measureCaption(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    type Node = { text(): string };
    type Stage = { find(selector: string): Node[] };
    const stage = (window as unknown as { Konva?: { stages: Stage[] } }).Konva?.stages[0];
    const found = stage?.find('.measure-caption') ?? [];
    return found[0]?.text() ?? null;
  });
}

/** Подписи длин стен: id стены → текст подписи. */
async function wallLabels(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    type Node = { id(): string; text(): string };
    type Stage = { find(selector: string): Node[] };
    const stage = (window as unknown as { Konva?: { stages: Stage[] } }).Konva?.stages[0];
    const nodes = stage?.find('.wall-length') ?? [];
    return Object.fromEntries(
      nodes.map((node) => [node.id().replace(/^wall-length-/, ''), node.text()]),
    );
  });
}

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/');
  await expect(page.locator('.editor-canvas canvas').first()).toBeVisible();
});

test('линейка меряет расстояние между двумя точками и убирается Escape', async ({ page }) => {
  await page.getByRole('button', { name: 'Линейка' }).click();
  await expect(page.getByRole('button', { name: 'Линейка' })).toHaveAttribute('aria-pressed', 'true');
  expect(await measureCaption(page)).toBeNull();

  await clickWorld(page, 1, 1);
  await clickWorld(page, 5, 1);
  expect(await measureCaption(page)).toBe('4,00\u00A0м');

  await page.keyboard.press('Escape');
  expect(await measureCaption(page)).toBeNull();
});

test('измерение не трогает план: он остаётся сохранённым', async ({ page }) => {
  await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'demo', 'before.json'));
  await expect(page.getByText('сохранено')).toBeVisible();

  await page.getByRole('button', { name: 'Линейка' }).click();
  await clickWorld(page, 2, 2);
  await clickWorld(page, 6, 4);
  expect(await measureCaption(page)).not.toBeNull();

  await expect(page.getByText('сохранено')).toBeVisible();
});

test('демо-план: каждая подпись длины равна настоящей длине своей стены', async ({ page }) => {
  await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'demo', 'before.json'));
  await expect.poll(async () => Object.keys(await wallLabels(page)).length).toBeGreaterThan(0);

  const plan = JSON.parse(readFileSync(join(process.cwd(), 'demo', 'before.json'), 'utf8')) as {
    walls: { id: string; from: [number, number]; to: [number, number] }[];
  };
  const labels = await wallLabels(page);

  for (const [id, text] of Object.entries(labels)) {
    const wall = plan.walls.find((entry) => entry.id === id);
    expect(wall, `подписана стена ${id}, которой нет в плане`).toBeDefined();
    const length = Math.hypot(wall!.to[0] - wall!.from[0], wall!.to[1] - wall!.from[1]);
    expect(text).toBe(`${length.toFixed(2).replace('.', ',')}\u00A0м`);
  }
});

test('короткая перегородка подпись получает только тогда, когда та на ней помещается', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Перегородка' }).click();
  await clickWorld(page, 2, 2);
  await clickWorld(page, 2.5, 2);

  // Наружные стены нового плана длинные и подписаны, а новая перегородка в
  // 0,5 м при стартовом масштабе подпись не получает: она туда не влезает.
  expect(Object.values(await wallLabels(page))).not.toContain('0,50\u00A0м');

  // Приблизили — та же перегородка стала длиннее подписи на экране.
  const centre = await worldPixel(page, 2.25, 2);
  await page.mouse.move(centre.x, centre.y);
  for (let step = 0; step < 12; step += 1) {
    await page.mouse.wheel(0, -120);
  }
  await expect.poll(async () => Object.values(await wallLabels(page))).toContain('0,50\u00A0м');
});
