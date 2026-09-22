/**
 * D-279 в браузере: форма объекта правится вершинами, сохраняется как новый
 * тип справочника, объект этого типа ставится из библиотеки уже с формой, и
 * всё это переживает сохранение и повторное открытие файла.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, exportPlan } from './fixtures';
import { showTab } from './side-tabs';

type Screen = { x: number; y: number };
type Saved = {
  objects: { id: string; typeId: string; size_m: [number, number]; outline?: [number, number][] }[];
  catalog: { objectTypes: { id: string; label: string; outline?: [number, number][] }[] };
};

const DEMO = join(process.cwd(), 'demo', 'before.json');
const TYPE_NAME = 'Стойка угловая e2e';
const RACK = 'Шкаф / стеллаж для посылок';
const card = (page: Page) => page.getByLabel('Свойства');

/** Two animation frames: Konva has drawn the scene and its hit canvas. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

/** A Konva node's position on the page, by its name on the stage. */
async function nodeOnPage(page: Page, name: string): Promise<Screen> {
  await settle(page);
  const local = await page.evaluate((selector) => {
    type Node = { getAbsolutePosition(): { x: number; y: number } };
    const stage = (window as unknown as { Konva: { stages: { findOne(s: string): Node | undefined }[] } }).Konva.stages[0]!;
    const node = stage.findOne(selector);
    if (node === undefined) throw new Error(`на холсте нет ${selector}`);
    return node.getAbsolutePosition();
  }, `.${name}`);
  const box = await page.getByTestId('editor-canvas').boundingBox();
  if (box === null) throw new Error('холст не виден');
  return { x: box.x + local.x, y: box.y + local.y };
}

async function savePlan(page: Page): Promise<{ path: string; plan: Saved }> {
  const download = await Promise.all([page.waitForEvent('download'), exportPlan(page, 'JSON')]).then(([item]) => item);
  const path = await download.path();
  expect(path).not.toBeNull();
  return { path: path as string, plan: JSON.parse(readFileSync(path as string, 'utf8')) as Saved };
}

test('форма вершиной → новый тип → объект этого типа → сохранить → открыть заново', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByTestId('plan-file-input').setInputFiles(DEMO);

  // The biggest rectangular object of the demo: easy to hit, nothing on top of it.
  const demo = JSON.parse(readFileSync(DEMO, 'utf8')) as Saved;
  const target = demo.objects
    .filter((object) => object.outline === undefined)
    .sort((a, b) => b.size_m[0] * b.size_m[1] - a.size_m[0] * a.size_m[1])[0]!;

  // Double click on the object: shape mode, vertex handles appear.
  const centre = await nodeOnPage(page, `equipment-${target.id}`);
  await page.mouse.dblclick(centre.x, centre.y);
  await expect(page.getByTestId('plan-tools-notice')).toContainText('Правка формы');

  // Another tool ends the mode, and its line goes with it (D-282); back under
  // «Выбор» the mode is off until the next double click.
  const tools = page.getByRole('toolbar', { name: 'Инструменты плана' });
  await tools.getByRole('button', { name: 'Зона', exact: true }).click();
  await expect(page.getByTestId('plan-tools-notice')).toHaveCount(0);
  await tools.getByRole('button', { name: 'Выбор', exact: true }).click();
  await expect(page.getByTestId('plan-tools-notice')).toHaveCount(0);
  await page.mouse.dblclick(centre.x, centre.y);
  await expect(page.getByTestId('plan-tools-notice')).toContainText('Правка формы');

  // Pull one corner out, Alt keeps it under the pointer (no snapping).
  const corner = await nodeOnPage(page, 'shape-vertex-2');
  await page.keyboard.down('Alt');
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x + 5, corner.y - 5);
  await page.mouse.move(corner.x + 30, corner.y - 30, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await page.keyboard.press('Enter');

  // A pick on the plan shows the card by itself (D-268).
  await expect(card(page)).toHaveAttribute('data-entity-id', target.id);
  await expect(card(page).getByTestId('props-shape')).toContainText('Форма: своя, вершин — 4');
  // One gesture — one undo step, and redo brings it back.
  await page.keyboard.press('Control+z');
  await expect(card(page).getByTestId('props-shape')).toContainText('Форма: как у типа');
  await page.keyboard.press('Control+y');
  await expect(card(page).getByTestId('props-shape')).toContainText('Форма: своя, вершин — 4');

  // «Своя фигура»: a type from the library, then a polygon by clicks, Enter closes it.
  await showTab(page, 'Библиотека');
  await page.locator('.library__item', { hasText: RACK }).first().click();
  await page.getByRole('button', { name: 'Нарисовать свою фигуру' }).click();
  await expect(page.getByTestId('shape-draw-hint')).toContainText(RACK);
  const canvas = await page.getByTestId('editor-canvas').boundingBox();
  if (canvas === null) throw new Error('холст не виден');
  const base = { x: canvas.x + 120, y: canvas.y + canvas.height - 160 };
  await page.keyboard.down('Alt');
  for (const [dx, dy] of [[0, 0], [90, 0], [90, 40], [40, 40], [40, 90], [0, 90]] as const) {
    await settle(page);
    await page.mouse.click(base.x + dx, base.y + dy);
  }
  await page.keyboard.up('Alt');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Выбор', exact: true }).click();

  // Back to the edited object for the card.
  await page.mouse.click(centre.x, centre.y);
  await expect(card(page)).toHaveAttribute('data-entity-id', target.id);

  // Save the shape as a catalog type.
  await card(page).getByLabel('Название нового типа').fill(TYPE_NAME);
  await card(page).getByRole('button', { name: 'Сохранить форму как новый тип' }).click();
  await expect(card(page).getByText(`Тип «${TYPE_NAME}» добавлен в библиотеку.`)).toBeVisible();

  // Place an object of the new type: the library item shows its outline.
  await showTab(page, 'Библиотека');
  const item = page.locator('.library__item', { hasText: TYPE_NAME });
  await expect(item.locator('svg.library__swatch--shape')).toBeVisible();
  await item.click();
  const box = await page.getByTestId('editor-canvas').boundingBox();
  if (box === null) throw new Error('холст не виден');
  await settle(page);
  await page.mouse.click(box.x + 40, box.y + box.height - 40);
  await page.getByRole('button', { name: 'Выбор', exact: true }).click();

  const first = await savePlan(page);
  const type = first.plan.catalog.objectTypes.find((entry) => entry.label === TYPE_NAME);
  expect(type?.outline).toHaveLength(4);
  const edited = first.plan.objects.find((object) => object.id === target.id)!;
  expect(edited.outline).toEqual(type?.outline);
  expect(edited.size_m[0]).toBeGreaterThan(target.size_m[0]);
  const drawn = first.plan.objects.filter(
    (object) => object.id !== target.id && object.outline?.length === 6 && !demo.objects.some((known) => known.id === object.id),
  );
  expect(drawn).toHaveLength(1);
  expect(first.plan.catalog.objectTypes.find((entry) => entry.id === drawn[0]!.typeId)?.label).toBe(RACK);
  const placed = first.plan.objects.filter((object) => object.typeId === type?.id);
  expect(placed).toHaveLength(1);
  expect(placed[0]!.outline).toEqual(type?.outline);

  // Reopen: the same file comes back out.
  await page.reload();
  await page.getByTestId('plan-file-input').setInputFiles(first.path);
  await showTab(page, 'Библиотека');
  await expect(page.locator('.library__item', { hasText: TYPE_NAME }).locator('svg')).toBeVisible();
  const second = await savePlan(page);
  expect(second.plan).toEqual(first.plan);
  expect(errors).toEqual([]);
});
