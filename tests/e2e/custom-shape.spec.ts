/**
 * D-279 в браузере: форма объекта правится вершинами, сохраняется как новый
 * тип справочника, объект этого типа ставится из библиотеки уже с формой, и
 * всё это переживает сохранение и повторное открытие файла.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, exportPlan, passPhysicsBlock } from './fixtures';
import { showTab } from './side-tabs';

type Screen = { x: number; y: number };
type Saved = {
  objects: {
    id: string;
    typeId: string;
    size_m: [number, number];
    // Нужны, чтобы выбрать цель со свободным местом вокруг (D-286).
    position: [number, number];
    rotation_deg: number;
    outline?: [number, number][];
  }[];
  catalog: { objectTypes: { id: string; label: string; outline?: [number, number][] }[] };
};

const DEMO = join(process.cwd(), 'demo', 'before.json');
const TYPE_NAME = 'Стойка угловая e2e';
const RACK = 'Шкаф / стеллаж для посылок';
const card = (page: Page) => page.getByLabel('Свойства');
const demo = JSON.parse(readFileSync(DEMO, 'utf8')) as Saved;

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

/** How many resize and rotation handles the equipment layer draws right now. */
async function objectHandles(page: Page): Promise<number> {
  await settle(page);
  return page.evaluate(() => {
    type Node = { name(): string };
    const stage = (window as unknown as { Konva: { stages: { find(f: (n: Node) => boolean): Node[] }[] } }).Konva
      .stages[0]!;
    return stage.find((node) => node.name().startsWith('handle-resize-') || node.name() === 'handle-rotate').length;
  });
}

async function savePlan(page: Page): Promise<{ path: string; plan: Saved }> {
  // Нарисованный кликами многоугольник может лечь на соседа: сохранение тогда
  // спрашивает подтверждения (D-286), и сценарий его даёт — предмет теста в форме.
  const started = page.waitForEvent('download');
  await exportPlan(page, 'JSON');
  await passPhysicsBlock(page);
  const download = await started;
  const path = await download.path();
  expect(path).not.toBeNull();
  return { path: path as string, plan: JSON.parse(readFileSync(path as string, 'utf8')) as Saved };
}

/** A large unobstructed rectangle with room for the vertex gesture. */
function growableTarget(): Saved['objects'][number] {
  const GROWTH_M = 0.8;
  const spaceOf = (object: Saved['objects'][number], pad = 0): [number, number, number, number] => {
    const turn = (object.rotation_deg * Math.PI) / 180;
    const [sx, sy] = object.size_m;
    const width = Math.abs(sx * Math.cos(turn)) + Math.abs(sy * Math.sin(turn));
    const height = Math.abs(sx * Math.sin(turn)) + Math.abs(sy * Math.cos(turn));
    const [x, y] = object.position;
    return [x - width / 2, x + width / 2 + pad, y - height / 2, y + height / 2 + pad];
  };
  const overlap = (a: [number, number, number, number], b: [number, number, number, number]): boolean =>
    a[0] < b[1] && b[0] < a[1] && a[2] < b[3] && b[2] < a[3];
  const target = demo.objects
    .filter((object) => object.outline === undefined)
    .filter((object) =>
      demo.objects.every(
        (other) => other.id === object.id || !overlap(spaceOf(object, GROWTH_M), spaceOf(other)),
      ),
    )
    .sort((a, b) => b.size_m[0] * b.size_m[1] - a.size_m[0] * a.size_m[1])[0];
  if (target === undefined) throw new Error('Демо не содержит объекта для проверки формы');
  return target;
}

test('режим формы выключается Enter и сменой инструмента', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('plan-file-input').setInputFiles(DEMO);
  const target = growableTarget();
  const centre = await nodeOnPage(page, `equipment-${target.id}`);
  await page.mouse.dblclick(centre.x, centre.y);
  await expect(page.getByTestId('plan-tools-notice')).toContainText('Правка формы');
  // D-290: shape vertices replace the object's resize and rotation handles.
  await expect.poll(() => objectHandles(page)).toBe(0);
  await page.keyboard.press('Enter');
  await expect.poll(() => objectHandles(page)).toBeGreaterThan(0);
  await page.mouse.dblclick(centre.x, centre.y);
  await expect(page.getByTestId('plan-tools-notice')).toContainText('Правка формы');

  // D-282: switching tools clears the mode and its hint.
  const tools = page.getByRole('toolbar', { name: 'Инструменты плана' });
  await tools.getByRole('button', { name: 'Зона', exact: true }).click();
  await expect(page.getByTestId('plan-tools-notice')).toHaveCount(0);
  await tools.getByRole('button', { name: 'Выбор', exact: true }).click();
  await expect(page.getByTestId('plan-tools-notice')).toHaveCount(0);
  await page.mouse.dblclick(centre.x, centre.y);
  await expect(page.getByTestId('plan-tools-notice')).toContainText('Правка формы');
});

test('форма вершиной → новый тип → объект этого типа → сохранить → открыть заново', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByTestId('plan-file-input').setInputFiles(DEMO);

  // The complete edit → type → placement → reopened-file route still runs in
  // one session; mode exit/re-entry has its own focused test above.
  const target = growableTarget();
  // Double click on the object: shape mode, vertex handles appear.
  const centre = await nodeOnPage(page, `equipment-${target.id}`);
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
  // Свободный пол демо-плана (склад у восточной стены, примерно 12,3–14,6 м по
  // X и 1,0–3,3 м по Y): многоугольник поверх чужого объёма физика не пропустит
  // (D-286), а здесь под фигуру 90 × 90 px места хватает.
  const base = { x: canvas.x + canvas.width * 0.786, y: canvas.y + canvas.height * 0.604 };
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
