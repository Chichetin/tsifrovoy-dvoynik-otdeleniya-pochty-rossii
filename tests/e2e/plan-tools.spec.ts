/**
 * U03 в браузере: помещение, зоны, перегородки и проёмы правятся на плане.
 *
 * Здесь проверяется то, чего не видно в unit-тестах: жест мышью по холсту
 * доходит до документа одной командой, отказ виден пользователю, а отмена
 * возвращает ровно один жест.
 *
 * Координаты берутся не из формул видового окна — их владелец U02, и
 * дублировать его арифметику в тесте нельзя. Вершина, поставленная кликом в
 * пиксель, там же и остаётся, а для стен и проёмов масштаб измеряется по факту:
 * два объекта ставятся в известные пиксели, их координаты читаются в карточке
 * свойств, и по двум точкам восстанавливается «мир → экран».
 *
 * Точка отсчёта — прямоугольник canvas сцены, а не обёртки: обёртка выше на
 * панель заголовка, и мышь по её координатам промахивается мимо ручки вершины.
 * Прямоугольник перечитывается перед каждым жестом — полоса ошибки над холстом
 * сдвигает его по странице, хотя план в сцене остаётся на месте.
 */

import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page, type TestInfo , exportPlan } from './fixtures';
import { showTab } from './side-tabs';

type Point = [number, number];
type Pixel = { x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };

type SavedPlan = {
  room: { boundary: Point[] };
  walls: { id: string; from: Point; to: Point; thickness_m: number }[];
  openings: { id: string; wallId: string; offset_m: number; width_m: number }[];
  zones: { id: string; name: string; parentId: string | null; polygon: Point[] }[];
};

/** Прямоугольник сцены Konva на странице: система координат всех жестов ниже. */
async function stageRect(page: Page): Promise<Rect> {
  const box = await page.locator('.editor-canvas canvas').first().boundingBox();
  if (box === null) throw new Error('сцена не смонтирована');
  return box;
}

/**
 * Открытый редактор: страница загружена, заголовок на месте, сцена
 * смонтирована. Ждать сцену явно, а не первым измерением: иначе медленный
 * dev-сервер даёт таймаут в `boundingBox`, из которого не видно, что именно
 * не дождались.
 */
async function openEditor(page: Page): Promise<Rect> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Цифровой двойник ОПС' })).toBeVisible();
  await expect(page.locator('.editor-canvas canvas').first()).toBeVisible();
  return stageRect(page);
}

async function onPage(page: Page, point: Pixel): Promise<Pixel> {
  const rect = await stageRect(page);
  return { x: rect.x + point.x, y: rect.y + point.y };
}

async function clickAt(page: Page, point: Pixel, options: { alt?: boolean } = {}): Promise<void> {
  const target = await onPage(page, point);
  // Alt: вершина ложится ровно под курсор, без привязки к сетке и соседям (D-209).
  if (options.alt) await page.keyboard.down('Alt');
  await page.mouse.click(target.x, target.y);
  if (options.alt) await page.keyboard.up('Alt');
}

async function dblclickAt(page: Page, point: Pixel): Promise<void> {
  const target = await onPage(page, point);
  await page.mouse.dblclick(target.x, target.y);
}

/** Жест мышью: нажать в точке, провести и отпустить — Konva тянет за drag. */
async function dragAt(
  page: Page,
  from: Pixel,
  to: Pixel,
  mid?: (page: Page) => Promise<void>,
): Promise<void> {
  const rect = await stageRect(page);
  await page.mouse.move(rect.x + from.x, rect.y + from.y);
  await page.mouse.down();
  await page.mouse.move(rect.x + (from.x + to.x) / 2, rect.y + (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(rect.x + to.x, rect.y + to.y, { steps: 4 });
  if (mid !== undefined) await mid(page);
  await page.mouse.up();
}

/**
 * Точка мира в пикселях сцены — по числам, которые холст сам публикует
 * (`data-visible`: «minX,minY,maxX,maxY» в метрах, D-130). Это не повтор
 * арифметики вида, а чтение её результата: попасть в угол контура иначе можно
 * только перебором пикселей. На экране Y вниз, в модели вверх.
 */
async function worldPixel(page: Page, x: number, y: number): Promise<Pixel> {
  const rect = await stageRect(page);
  const raw = await page.getByTestId('editor-canvas').getAttribute('data-visible');
  if (raw === null) throw new Error('холст не сообщил видимую область');
  const [minX, minY, maxX, maxY] = raw.split(',').map(Number) as [number, number, number, number];
  return {
    x: ((x - minX) / (maxX - minX)) * rect.width,
    y: ((maxY - y) / (maxY - minY)) * rect.height,
  };
}

/** Курсор в точку плана, без клика: маркер цели показывают до нажатия (D-224). */
async function hoverWorld(page: Page, x: number, y: number): Promise<void> {
  const target = await onPage(page, await worldPixel(page, x, y));
  await page.mouse.move(target.x, target.y);
}

/**
 * Маркер цели привязки, как его видно на сцене: имена линий говорят ось и цель
 * (`snap-marker-x-zone`), подпись — то же словами. Пусто — маркера нет.
 */
async function snapMarker(page: Page): Promise<{ caption: string; lines: string[] }> {
  return page.evaluate(() => {
    type Node = { name(): string; find(selector: string): Node[]; findOne(selector: string): Node | undefined };
    type TextNode = Node & { text(): string };
    const stage = (window as unknown as { Konva?: { stages: Node[] } }).Konva?.stages[0];
    const layer = stage?.findOne('.snap-marker');
    const lines = layer === undefined ? [] : layer.find('Line').map((node) => node.name());
    const caption = layer?.findOne('.snap-marker-caption')?.findOne('Text') as TextNode | undefined;
    return { caption: caption === undefined ? '' : caption.text(), lines };
  });
}

const areas = (page: Page): Locator => page.getByLabel('Площади');

async function roomArea(page: Page): Promise<string> {
  await showTab(page, 'Площади');
  return ((await areas(page).locator('dd').first().textContent()) ?? '').trim();
}

async function zoneArea(page: Page, name: string): Promise<string> {
  await showTab(page, 'Площади');
  const row = areas(page).locator('tbody tr', { hasText: name }).first();
  return ((await row.locator('td').nth(1).textContent()) ?? '').trim();
}

/** «1 234,56» → 1234.56: площадь нужна числом там, где сравнение с допуском. */
async function zoneAreaValue(page: Page, name: string): Promise<number> {
  return Number((await zoneArea(page, name)).replace(/\s/g, '').replace(',', '.'));
}

async function savePlanFile(page: Page): Promise<string> {
  const download = await Promise.all([
    page.waitForEvent('download'),
    exportPlan(page, 'JSON'),
  ]).then(([event]) => event);
  const path = await download.path();
  expect(path).not.toBeNull();
  return path as string;
}

async function savePlan(page: Page): Promise<SavedPlan> {
  return JSON.parse(readFileSync(await savePlanFile(page), 'utf8')) as SavedPlan;
}

/** Замкнутый контур: клики по вершинам и клик по первой точке, который замыкает. */
async function drawRing(
  page: Page,
  tool: 'Помещение' | 'Зона',
  ring: Pixel[],
  options: { alt?: boolean } = {},
): Promise<void> {
  await page.getByRole('button', { name: tool, exact: true }).click();
  for (const point of ring) await clickAt(page, point, options);
  const first = ring[0];
  if (first === undefined) throw new Error('пустой контур');
  await clickAt(page, first, options);
  await page.getByRole('button', { name: 'Выбор', exact: true }).click();
}

/** Доли сцены: тест не зависит от размера окна, а план — от порядка кликов. */
const ROOM = [
  [0.08, 0.08],
  [0.92, 0.08],
  [0.92, 0.92],
  [0.08, 0.92],
] as const;
const OUTER = [
  [0.2, 0.2],
  [0.8, 0.2],
  [0.8, 0.8],
  [0.2, 0.8],
] as const;
const INNER = [
  [0.3, 0.3],
  [0.6, 0.3],
  [0.6, 0.6],
  [0.3, 0.6],
] as const;

function px(size: Rect, fx: number, fy: number): Pixel {
  return { x: Math.round(size.width * fx), y: Math.round(size.height * fy) };
}

function ring(size: Rect, fractions: readonly (readonly [number, number])[]): Pixel[] {
  return fractions.map(([fx, fy]) => px(size, fx, fy));
}

/**
 * Помещение и две зоны: внешняя и нарисованная внутри неё вложенная. Рисуется
 * с Alt: тесты ниже целятся в вершины и рёбра по тем же долям сцены, и привязка
 * (D-209) сдвинула бы вершины относительно кликов.
 */
async function drawPlan(page: Page, size: Rect): Promise<void> {
  await drawRing(page, 'Помещение', ring(size, ROOM), { alt: true });
  await page.keyboard.press('Escape');
  await drawRing(page, 'Зона', ring(size, OUTER), { alt: true });
  await page.keyboard.press('Escape');
  await drawRing(page, 'Зона', ring(size, INNER), { alt: true });
  await page.keyboard.press('Escape');
}

test.describe('инструменты плана', () => {
  test('нарисованная зона сразу выбрана, соседняя зона Т-стыком не портит её контур', async ({
    page,
  }) => {
    const size = await openEditor(page);
    const card = page.getByLabel('Свойства');
    const left = ring(size, [
      [0.2, 0.2],
      [0.5, 0.2],
      [0.5, 0.8],
      [0.2, 0.8],
    ]);
    await page.getByRole('button', { name: 'Зона', exact: true }).click();
    for (const point of left) await clickAt(page, point);
    await clickAt(page, left[0] as Pixel);
    await expect(card).toHaveAttribute('data-entity-id', 'z_1');

    // Вторая зона подряд, без «Выбора»: её первый угол — середина правого ребра
    // первой. Ручек и «широких» рёбер выбранной зоны под инструментом нет,
    // поэтому клик ставит вершину черновика, а не вставляет вершину в z_1.
    const right = ring(size, [
      [0.5, 0.5],
      [0.8, 0.5],
      [0.8, 0.8],
      [0.5, 0.8],
    ]);
    for (const point of right) await clickAt(page, point);
    await clickAt(page, right[0] as Pixel);
    await expect(card).toHaveAttribute('data-entity-id', 'z_2');
    await expect(card.getByTestId('props-vertices')).toContainText('Вершин в контуре: 4');

    await page.getByRole('button', { name: 'Выбор', exact: true }).click();
    await clickAt(page, px(size, 0.3, 0.3));
    await expect(card).toHaveAttribute('data-entity-id', 'z_1');
    await expect(card.getByTestId('props-vertices')).toContainText('Вершин в контуре: 4');
  });

  test('три клика и Enter замыкают зону одной правкой (D-262)', async ({ page }) => {
    const size = await openEditor(page);
    const card = page.getByLabel('Свойства');
    const triangle = ring(size, [
      [0.2, 0.2],
      [0.6, 0.2],
      [0.6, 0.7],
    ]);
    await page.getByRole('button', { name: 'Зона', exact: true }).click();
    await clickAt(page, triangle[0] as Pixel);
    await clickAt(page, triangle[1] as Pixel);
    // Двух точек мало: Enter объясняет и ничего не создаёт.
    await page.keyboard.press('Enter');
    await expect(page.getByText(/нужно не меньше трёх точек/)).toBeVisible();
    await clickAt(page, triangle[2] as Pixel);
    await page.keyboard.press('Enter');
    await expect(card).toHaveAttribute('data-entity-id', 'z_1');
    await expect(card.getByTestId('props-vertices')).toContainText('Вершин в контуре: 3');

    const saved = await savePlan(page);
    const zone = saved.zones.find((entry) => entry.id === 'z_1');
    expect(zone?.polygon).toHaveLength(3);
  });

  test('клики и двойной клик замыкают зону без дубля последней вершины (D-262)', async ({ page }) => {
    const size = await openEditor(page);
    const card = page.getByLabel('Свойства');
    const quad = ring(size, [
      [0.2, 0.2],
      [0.6, 0.2],
      [0.6, 0.7],
      [0.2, 0.7],
    ]);
    await page.getByRole('button', { name: 'Зона', exact: true }).click();
    for (const point of quad.slice(0, 3)) await clickAt(page, point);
    await dblclickAt(page, quad[3] as Pixel);
    await expect(card).toHaveAttribute('data-entity-id', 'z_1');
    await expect(card.getByTestId('props-vertices')).toContainText('Вершин в контуре: 4');

    const saved = await savePlan(page);
    const polygon = saved.zones.find((entry) => entry.id === 'z_1')?.polygon ?? [];
    expect(polygon).toHaveLength(4);
    // Ни одного вырожденного ребра: соседние вершины, включая замыкающее ребро, различны.
    for (const [index, point] of polygon.entries()) {
      const next = polygon[(index + 1) % polygon.length] as Point;
      expect(Math.hypot(point[0] - next[0], point[1] - next[1])).toBeGreaterThan(0.1);
    }
  });

  test('вершина зоны у угла помещения ложится ровно на грань стены; с Alt — куда кликнули (D-209)', async ({
    page,
  }) => {
    await openEditor(page);
    const start = await savePlan(page);
    const corner = start.room.boundary[0];
    if (corner === undefined) throw new Error('у помещения нет контура');
    // Клик в 0,1 м внутрь от угла по обеим осям: до внутренней грани стены
    // (0,125 м от оси) — 0,025 м, до оси — 0,1 м; в допуске 8 px при любом
    // масштабе до 320 px/м.
    const near = await worldPixel(page, corner[0] + 0.1, corner[1] + 0.1);
    const box = (from: Pixel): Pixel[] => [from, { x: from.x + 150, y: from.y }, { x: from.x + 150, y: from.y - 120 }, { x: from.x, y: from.y - 120 }];

    await drawRing(page, 'Зона', box(near));
    await page.keyboard.press('Escape');
    const snapped = await savePlan(page);
    // Ближе всего внутренняя грань наружной стены (угол контура плюс половина
    // толщины), а не ось — вершина ложится ровно на неё: грань 0,125 хранится как
    // есть, а не как 0,13 (D-211).
    const half = (start.walls[0]?.thickness_m ?? 0) / 2;
    expect(snapped.zones[0]?.polygon[0]).toEqual([corner[0] + half, corner[1] + half]);

    await drawRing(page, 'Зона', box({ x: near.x, y: near.y - 200 }), { alt: true });
    await page.keyboard.press('Escape');
    const free = await savePlan(page);
    const vertex = free.zones[1]?.polygon[0];
    if (vertex === undefined) throw new Error('вторая зона не нарисована');
    // Без привязки вершина легла туда, куда кликнули: ни на ось, ни на грань стены.
    expect(vertex[0]).not.toBe(corner[0]);
    expect(vertex[0]).not.toBe(corner[0] + half);
  });

  test('Ctrl: протяжка ребра вытягивает выступ, клик по вершине её удаляет (D-247)', async ({ page }) => {
    const size = await openEditor(page);
    await drawPlan(page, size);
    const start = await savePlan(page);
    const before = start.room.boundary;
    const [first, second] = [before[0], before[1]];
    if (first === undefined || second === undefined) throw new Error('у помещения нет контура');

    // Выбрать помещение: пол между его контуром и внешней зоной.
    await clickAt(page, px(size, 0.12, 0.12));
    await expect(page.getByLabel('Свойства')).toHaveAttribute('data-entity-id', 'room_main');

    // Середина первого ребра — и тянем её наружу на метр с зажатым Ctrl.
    const middle: Point = [(first[0] + second[0]) / 2, (first[1] + second[1]) / 2];
    const outward: Point = [middle[0], middle[1] - 1];
    await page.keyboard.down('Control');
    await dragAt(page, await worldPixel(page, middle[0], middle[1]), await worldPixel(page, outward[0], outward[1]));
    await page.keyboard.up('Control');

    await expect.poll(async () => (await savePlan(page)).room.boundary.length).toBe(before.length + 1);
    const pulled = (await savePlan(page)).room.boundary;
    const added = pulled.find((vertex) => !before.some((old) => old[0] === vertex[0] && old[1] === vertex[1]));
    if (added === undefined) throw new Error('новой вершины в контуре нет');
    expect(Math.abs(added[0] - outward[0])).toBeLessThan(0.6);
    expect(Math.abs(added[1] - outward[1])).toBeLessThan(0.6);

    // Ctrl + клик по этой же вершине убирает её, и контур возвращается к прежнему.
    await clickAt(page, px(size, 0.12, 0.12));
    await expect(page.getByLabel('Свойства')).toHaveAttribute('data-entity-id', 'room_main');
    const handle = await worldPixel(page, added[0], added[1]);
    const onStage = await onPage(page, handle);
    await page.keyboard.down('Control');
    await page.mouse.click(onStage.x, onStage.y);
    await page.keyboard.up('Control');

    await expect.poll(async () => (await savePlan(page)).room.boundary.length).toBe(before.length);
  });

  test('ручка вершины притягивается к вершине соседней зоны; с Alt — нет (D-210)', async ({ page }) => {
    const size = await openEditor(page);
    await drawPlan(page, size);
    const start = await savePlan(page);
    const target = start.zones[0]?.polygon[0];
    const own = start.zones[1]?.polygon[0];
    if (target === undefined || own === undefined) throw new Error('зоны не нарисованы');

    // Выбрать вложенную зону и потянуть её первую вершину в 5 см от вершины внешней.
    await clickAt(page, px(size, 0.45, 0.45));
    await expect(page.getByLabel('Свойства')).toHaveAttribute('data-entity-id', 'z_2');
    const from = await worldPixel(page, own[0], own[1]);
    const near = await worldPixel(page, target[0] + 0.05, target[1] + 0.05);
    await dragAt(page, from, near);
    await expect.poll(async () => (await savePlan(page)).zones[1]?.polygon[0]).toEqual(target);

    // Угол помещения тянется наружу в точку посередине между узлами сетки: грани
    // его же наружных стен (0,125 м от старого угла) могут оказаться в допуске, но
    // направляющими не считаются — вершина ложится туда, куда отпустили (плюс-минус
    // порог начала drag), с точностью до сантиметра. Мутант «стены остаются» — красный.
    const corner = start.room.boundary[0];
    if (corner === undefined) throw new Error('у помещения нет контура');
    const midway = (value: number): number => Math.floor((value - 0.3) / 0.5) * 0.5 + 0.25;
    const aim: Point = [midway(corner[0]), midway(corner[1])];
    // Пол между контуром и внешней зоной: выбирается помещение.
    await clickAt(page, px(size, 0.12, 0.12));
    await expect(page.getByLabel('Свойства')).toHaveAttribute('data-entity-id', 'room_main');
    await dragAt(page, await worldPixel(page, corner[0], corner[1]), await worldPixel(page, aim[0], aim[1]));
    await expect
      .poll(async () => {
        const moved = (await savePlan(page)).room.boundary[0];
        return moved === undefined ? null : Math.max(Math.abs(moved[0] - aim[0]), Math.abs(moved[1] - aim[1]));
      })
      .toBeLessThan(0.06);
    const landed = (await savePlan(page)).room.boundary[0];
    if (landed === undefined) throw new Error('контур пропал');
    expect(landed.map((value) => Math.round(value * 100) / 100)).toEqual(landed);
    await page.keyboard.press('Control+z');
    await clickAt(page, px(size, 0.45, 0.45));

    // Тот же жест с Alt: вершина остаётся в 5 см от соседней.
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await savePlan(page)).zones[1]?.polygon[0]).toEqual(own);
    await page.keyboard.down('Alt');
    await dragAt(page, from, near);
    await page.keyboard.up('Alt');
    const free = (await savePlan(page)).zones[1]?.polygon[0];
    if (free === undefined) throw new Error('вершина пропала');
    expect(free[0]).not.toBe(target[0]);
    expect(Math.abs(free[0] - target[0] - 0.05)).toBeLessThan(0.02);
  });

  test('контур помещения и вложенной зоны правится на плане', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    const size = await openEditor(page);
    const card = page.getByLabel('Свойства');

    // Помещение из шаблона — 12 × 9 м; нарисованное считается по контуру.
    expect(await roomArea(page)).toBe('108,00\u00a0м²');
    await drawRing(page, 'Помещение', ring(size, ROOM));
    const drawnRoom = await roomArea(page);
    expect(drawnRoom).not.toBe('108,00\u00a0м²');

    // Готовое помещение правится на плане: выбрать и подвинуть вершину.
    await clickAt(page, px(size, 0.5, 0.5));
    await expect(page.getByText(/Контур: тяните вершину/)).toBeVisible();
    await dragAt(page, px(size, 0.08, 0.08), px(size, 0.2, 0.2));
    await expect.poll(() => roomArea(page)).not.toBe(drawnRoom);
    await page.keyboard.press('Escape');

    // Зона внутри зоны: вложенность берётся из геометрии, а не из формы.
    await drawRing(page, 'Зона', ring(size, OUTER));
    await page.keyboard.press('Escape');
    await drawRing(page, 'Зона', ring(size, INNER));
    await page.keyboard.press('Escape');

    await clickAt(page, px(size, 0.45, 0.45));
    await expect(card).toHaveAttribute('data-entity-id', 'z_2');
    await expect(card.getByLabel('Внутри зоны')).toHaveValue('z_1');
    await expect(card.getByTestId('props-vertices')).toContainText('Вершин в контуре: 4');

    // Вершина переезжает: одна команда на жест, площадь зоны пересчитана.
    const before = await zoneArea(page, 'Зона 2');
    await dragAt(page, px(size, 0.3, 0.3), px(size, 0.38, 0.38));
    await expect.poll(() => zoneArea(page, 'Зона 2')).not.toBe(before);
    const moved = await zoneArea(page, 'Зона 2');
    await expect(card.getByTestId('props-vertices')).toContainText('Вершин в контуре: 4');

    // Клик по ребру добавляет вершину, двойной клик по ней — убирает. Новая
    // вершина садится на своё ребро: форма зоны от этого не меняется, и
    // площадь остаётся прежней с точностью до сантиметровой привязки.
    const area = await zoneAreaValue(page, 'Зона 2');
    await clickAt(page, px(size, 0.45, 0.6));
    await expect(card.getByTestId('props-vertices')).toContainText('Вершин в контуре: 5');
    expect(Math.abs((await zoneAreaValue(page, 'Зона 2')) - area)).toBeLessThan(0.02);
    await dblclickAt(page, px(size, 0.45, 0.6));
    await expect(card.getByTestId('props-vertices')).toContainText('Вершин в контуре: 4');
    expect(await zoneArea(page, 'Зона 2')).toBe(moved);

    // Повторное открытие: правка вершины пережила сохранение и загрузку.
    const file = await savePlanFile(page);
    const saved = JSON.parse(readFileSync(file, 'utf8')) as SavedPlan;
    expect(saved.zones.map((zone) => zone.id)).toEqual(['z_1', 'z_2']);
    expect(saved.zones[1]?.parentId).toBe('z_1');
    expect(saved.zones[1]?.polygon).toHaveLength(4);

    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Создать новый' }).click();
    await showTab(page, 'Площади');
    await expect(page.getByText('Зоны ещё не размечены')).toBeVisible();

    await page.getByTestId('plan-file-input').setInputFiles(file);
    await expect.poll(() => zoneArea(page, 'Зона 2')).toBe(moved);
    expect(await roomArea(page)).not.toBe('108,00\u00a0м²');

    expect(errors).toEqual([]);
  });

  test('зона поверх соседней: вложенная — тихо, наполовину вышедшая — одна находка (D-223)', async ({
    page,
  }) => {
    const size = await openEditor(page);
    const card = page.getByLabel('Свойства');
    const checks = page.getByLabel('Проверка плана');
    // Наполовину вышла из внешней зоны: слева 0,1 против её 0,2.
    const HALF = [
      [0.1, 0.3],
      [0.5, 0.3],
      [0.5, 0.6],
      [0.1, 0.6],
    ] as const;

    await drawRing(page, 'Помещение', ring(size, ROOM), { alt: true });
    await page.keyboard.press('Escape');
    await drawRing(page, 'Зона', ring(size, OUTER), { alt: true });
    await page.keyboard.press('Escape');

    await drawRing(page, 'Зона', ring(size, HALF), { alt: true });
    await page.keyboard.press('Escape');
    // Левый край новой зоны лежит вне внешней: клик по нему выбирает только её.
    await clickAt(page, px(size, 0.15, 0.45));
    await expect(card).toHaveAttribute('data-entity-id', 'z_2');
    await expect(card.getByLabel('Внутри зоны')).toHaveValue('');
    await expect(checks).toContainText('пересекаются, не вкладываясь');

    // Та же зона, обведённая целиком внутри: вложенность, а не находка.
    await page.getByRole('button', { name: 'Отменить' }).click();
    await drawRing(page, 'Зона', ring(size, INNER), { alt: true });
    await page.keyboard.press('Escape');
    await clickAt(page, px(size, 0.45, 0.45));
    // Отмена вернула id: это снова z_2, но уже вложенная зона, а не находка.
    await expect(card).toHaveAttribute('data-entity-id', 'z_2');
    await expect(card.getByLabel('Внутри зоны')).toHaveValue('z_1');
    await expect(checks).not.toContainText('пересекаются, не вкладываясь');
  });

  test('самопересечение отклоняется, а зона удаляется и возвращается отменой', async ({
    page,
  }, testInfo: TestInfo) => {
    const size = await openEditor(page);
    await drawPlan(page, size);

    await clickAt(page, px(size, 0.45, 0.45));
    const card = page.getByLabel('Свойства');
    await expect(card).toHaveAttribute('data-entity-id', 'z_2');
    const before = await zoneArea(page, 'Зона 2');

    // Вершина уезжает за противоположное ребро: контур становится «бабочкой».
    await dragAt(page, px(size, 0.3, 0.3), px(size, 0.72, 0.45), async (active) => {
      // Пока кнопка нажата, контур подсвечен красным — это видно только на
      // холсте, поэтому кадр остаётся в отчёте как доказательство.
      await testInfo.attach('самопересечение на плане', {
        body: await active.screenshot(),
        contentType: 'image/png',
      });
    });

    await expect(page.getByTestId('plan-tools-notice')).toContainText('самопересекается');
    // Документ не испорчен: площадь прежняя, вершин столько же.
    expect(await zoneArea(page, 'Зона 2')).toBe(before);
    await expect(card.getByTestId('props-vertices')).toContainText('Вершин в контуре: 4');

    // Удаление выбранной зоны и возврат отменой — один шаг истории.
    await page.getByRole('button', { name: 'Удалить зону' }).click();
    await expect(areas(page).locator('tbody tr')).toHaveCount(1);
    // Выбор снят вместе с зоной — карточки свойств в колонке нет вовсе (D-249).
    await expect(card).toHaveCount(0);

    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(areas(page).locator('tbody tr')).toHaveCount(2);
    expect(await zoneArea(page, 'Зона 2')).toBe(before);
  });

  test('Escape в чужом жесте: правка контура не обрывается, выделение остаётся', async ({
    page,
  }) => {
    const size = await openEditor(page);
    await drawRing(page, 'Зона', ring(size, OUTER));
    await page.keyboard.press('Escape');

    const card = page.getByLabel('Свойства');
    await clickAt(page, px(size, 0.5, 0.5));
    await expect(card).toHaveAttribute('data-entity-id', 'z_1');
    const before = await zoneArea(page, 'Зона 1');

    // Жест соседнего слоя: тянем вершину и посреди пути жмём Escape. Ручки
    // оборудования его не касаются — жест доходит до отпускания кнопки.
    const from = px(size, 0.2, 0.2);
    const half = px(size, 0.25, 0.25);
    const to = px(size, 0.3, 0.3);
    const rect = await stageRect(page);
    await page.mouse.move(rect.x + from.x, rect.y + from.y);
    await page.mouse.down();
    await page.mouse.move(rect.x + half.x, rect.y + half.y, { steps: 4 });
    await page.keyboard.press('Escape');
    await page.mouse.move(rect.x + to.x, rect.y + to.y, { steps: 4 });
    await page.mouse.up();

    // Выделение не снято: карточка выбранной зоны на месте.
    await expect(card).toHaveAttribute('data-entity-id', 'z_1');
    await expect.poll(() => zoneArea(page, 'Зона 1')).not.toBe(before);
    const withEscape = await zoneAreaValue(page, 'Зона 1');

    // Тот же жест без Escape даёт ту же зону: клавиша ничего не оборвала на
    // полпути — иначе вершина осталась бы в середине пути.
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect.poll(() => zoneArea(page, 'Зона 1')).toBe(before);
    await dragAt(page, from, to);
    expect(await zoneAreaValue(page, 'Зона 1')).toBeCloseTo(withEscape, 2);
  });

  test('строка отказа живёт до смены выбора, Backspace удаляет зону', async ({ page }) => {
    const size = await openEditor(page);
    await drawPlan(page, size);

    const card = page.getByLabel('Свойства');
    const notice = page.getByTestId('plan-tools-notice');

    await clickAt(page, px(size, 0.45, 0.45));
    await expect(card).toHaveAttribute('data-entity-id', 'z_2');
    // Отказ: вершина уезжает за противоположное ребро.
    await dragAt(page, px(size, 0.3, 0.3), px(size, 0.72, 0.45));
    await expect(notice).toContainText('самопересекается');

    // Выбрали другую зону — отказ был про прошлую, он гаснет.
    await clickAt(page, px(size, 0.25, 0.25));
    await expect(card).toHaveAttribute('data-entity-id', 'z_1');
    await expect(notice).toHaveCount(0);

    // Клик у вершины не добавляет её: там целились в угол, а не в ребро.
    await clickAt(page, px(size, 0.45, 0.45));
    await expect(card.getByTestId('props-vertices')).toContainText('Вершин в контуре: 4');
    await clickAt(page, px(size, 0.32, 0.6));
    await expect(notice).toContainText('вершин');
    await expect(card.getByTestId('props-vertices')).toContainText('Вершин в контуре: 4');

    // Ближе к середине ребра вершина добавляется, и отказ гаснет.
    await clickAt(page, px(size, 0.45, 0.6));
    await expect(card.getByTestId('props-vertices')).toContainText('Вершин в контуре: 5');
    await expect(notice).toHaveCount(0);

    // Backspace удаляет выбранную зону так же, как Delete и кнопка панели.
    await page.keyboard.press('Backspace');
    await expect(areas(page).locator('tbody tr')).toHaveCount(1);
    // Выбор снят вместе с зоной — карточки свойств в колонке нет вовсе (D-249).
    await expect(card).toHaveCount(0);

    // Новый план гасит строку отказа вместе с планом, о котором она была.
    await clickAt(page, px(size, 0.5, 0.5));
    await expect(card).toHaveAttribute('data-entity-id', 'z_1');
    await clickAt(page, px(size, 0.24, 0.2));
    await expect(notice).toContainText('вершин');

    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Создать новый' }).click();
    await showTab(page, 'Площади');
    await expect(page.getByText('Зоны ещё не размечены')).toBeVisible();
    await expect(notice).toHaveCount(0);
  });

  test('проём и перегородка правятся, отмена сохраняет связь проёма со стеной', async ({
    page,
  }) => {
    const size = await openEditor(page);

    // Масштаб измеряется, а не вычисляется: два объекта в известных пикселях.
    const probe = async (fx: number, fy: number): Promise<{ pixel: Pixel; world: Point }> => {
      const pixel = px(size, fx, fy);
      await showTab(page, 'Библиотека');
      await page.locator('.library__item').first().click();
      await clickAt(page, pixel);
      await page.getByRole('button', { name: 'Выбор', exact: true }).click();
      await clickAt(page, pixel);
      const card = page.getByLabel('Свойства');
      const x = Number(await card.getByLabel('X, м').inputValue());
      const y = Number(await card.getByLabel('Y, м').inputValue());
      return { pixel, world: [x, y] };
    };

    const first = await probe(0.3, 0.3);
    const second = await probe(0.7, 0.7);
    await page.getByRole('button', { name: 'Отменить' }).click();
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(page.getByText('Оборудование ещё не размещено')).toBeVisible();

    const scale = (second.pixel.x - first.pixel.x) / (second.world[0] - first.world[0]);
    expect(scale).toBeGreaterThan(4);
    expect(scale).toBeLessThan(400);
    const origin: Point = [
      first.pixel.x - first.world[0] * scale,
      first.pixel.y + first.world[1] * scale,
    ];
    const toStage = (world: Point): Pixel => ({
      x: Math.round(origin[0] + world[0] * scale),
      y: Math.round(origin[1] - world[1] * scale),
    });

    const initial = await savePlan(page);
    const opening = initial.openings[0];
    if (opening === undefined) throw new Error('в новом плане нет проёма');
    const wall = initial.walls.find((entry) => entry.id === opening.wallId);
    if (wall === undefined) throw new Error('проём без стены');

    const length = Math.hypot(wall.to[0] - wall.from[0], wall.to[1] - wall.from[1]);
    const along = (offset: number): Point => [
      wall.from[0] + ((wall.to[0] - wall.from[0]) / length) * offset,
      wall.from[1] + ((wall.to[1] - wall.from[1]) / length) * offset,
    ];
    const centre = toStage(along(opening.offset_m + opening.width_m / 2));

    await clickAt(page, centre);
    await expect(page.getByRole('button', { name: 'Удалить проём' })).toBeVisible();

    // Сдвиг по экрану переводится в сдвиг вдоль стены: у стены своё
    // направление from → to, и проём едет по нему, а не по оси X экрана.
    const shift = -100;
    const alongShift = ((shift / scale) * (wall.to[0] - wall.from[0])) / length;
    await dragAt(page, centre, { x: centre.x + shift, y: centre.y });
    const afterDrag = await savePlan(page);
    const dragged = afterDrag.openings[0];
    expect(dragged?.wallId).toBe(opening.wallId);
    expect(Math.abs((dragged?.offset_m ?? 0) - opening.offset_m)).toBeGreaterThan(0.5);
    expect(dragged?.offset_m).toBeCloseTo(opening.offset_m + alongShift, 1);

    // Отмена возвращает жест целиком и не рвёт связь проёма со стеной.
    await page.getByRole('button', { name: 'Отменить' }).click();
    const afterUndo = await savePlan(page);
    expect(afterUndo.openings).toHaveLength(1);
    expect(afterUndo.openings[0]?.wallId).toBe(opening.wallId);
    expect(afterUndo.openings[0]?.offset_m).toBeCloseTo(opening.offset_m, 6);

    // Перегородка: выбрать стену без проёмов, подвинуть конец, удалить, вернуть.
    const free = initial.walls.find((entry) => entry.id !== opening.wallId);
    if (free === undefined) throw new Error('в плане одна стена');
    const middle = toStage([(free.from[0] + free.to[0]) / 2, (free.from[1] + free.to[1]) / 2]);
    await clickAt(page, middle);
    await expect(page.getByRole('button', { name: 'Удалить перегородку' })).toBeVisible();

    // Подсказка инструмента обещает правку в карточке свойств — она открыта и
    // толщина уходит в модель, а не только в поле ввода.
    const props = page.getByLabel('Свойства');
    // Своего заголовка у карточки нет (D-272), строки идентификатора тоже
    // (D-278): выбранное называет атрибут карточки, а «Толщина, м» есть только у стены.
    await expect(props).toHaveAttribute('data-entity-id', free.id);
    await props.getByLabel('Толщина, м').fill('0.35');
    const thicker = await savePlan(page);
    expect(thicker.walls.find((entry) => entry.id === free.id)?.thickness_m).toBeCloseTo(0.35, 6);

    const end = toStage(free.from);
    await dragAt(page, end, { x: end.x + 60, y: end.y + 60 });
    const bentPlan = await savePlan(page);
    const bent = bentPlan.walls.find((entry) => entry.id === free.id);
    expect(bent?.to).toEqual(free.to);
    expect(bent?.from[0]).toBeCloseTo(free.from[0] + 60 / scale, 1);
    expect(bent?.from[1]).toBeCloseTo(free.from[1] - 60 / scale, 1);
    expect(bentPlan.openings).toHaveLength(1);

    await page.getByRole('button', { name: 'Удалить перегородку' }).click();
    const withoutWall = await savePlan(page);
    expect(withoutWall.walls.map((entry) => entry.id)).not.toContain(free.id);
    expect(withoutWall.openings).toHaveLength(1);

    await page.getByRole('button', { name: 'Отменить' }).click();
    const restored = await savePlan(page);
    expect(restored.walls.map((entry) => entry.id)).toContain(free.id);
  });

  test('перегородка и проём создаются с нуля, промах объясняется', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    const size = await openEditor(page);
    const notice = page.getByTestId('plan-tools-notice');

    // Стартовый план — четыре наружные стены и один вход.
    const before = await savePlan(page);
    expect(before.walls).toHaveLength(4);

    // Перегородка: два клика внутри помещения.
    await page.getByRole('button', { name: 'Перегородка', exact: true }).click();
    await clickAt(page, px(size, 0.45, 0.25));
    await clickAt(page, px(size, 0.45, 0.75));
    await page.getByRole('button', { name: 'Выбор', exact: true }).click();

    const withWall = await savePlan(page);
    expect(withWall.walls).toHaveLength(5);
    const added = withWall.walls.find(
      (entry) => !before.walls.some((old) => old.id === entry.id),
    );
    expect(added).toBeDefined();
    // Перегородка вертикальная: клики шли по одному x.
    expect((added as SavedPlan['walls'][number]).from[0]).toBeCloseTo(
      (added as SavedPlan['walls'][number]).to[0],
      2,
    );

    // Проём мимо любой стены: клик не теряется молча, а объясняется.
    await page.getByRole('button', { name: 'Проём', exact: true }).click();
    await clickAt(page, px(size, 0.2, 0.5));
    await expect(notice).toContainText('нет стены');
    expect((await savePlan(page)).openings).toHaveLength(before.openings.length);

    // Проём по самой перегородке: встаёт на неё и держится в её пределах.
    await clickAt(page, px(size, 0.45, 0.5));
    await page.getByRole('button', { name: 'Выбор', exact: true }).click();

    const withOpening = await savePlan(page);
    expect(withOpening.openings).toHaveLength(before.openings.length + 1);
    const opening = withOpening.openings.find(
      (entry) => !before.openings.some((old) => old.id === entry.id),
    );
    expect(opening?.wallId).toBe((added as SavedPlan['walls'][number]).id);
    expect(opening?.offset_m).toBeGreaterThanOrEqual(0);

    // Одна команда на жест: «Отменить» убирает только проём.
    await page.getByRole('button', { name: 'Отменить' }).click();
    const undone = await savePlan(page);
    expect(undone.openings).toHaveLength(before.openings.length);
    expect(undone.walls).toHaveLength(5);

    expect(errors).toEqual([]);
  });

  test('проём — фиксированной ширины: на плане только двигается, Enter и смена инструмента завершают его (D-267)', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    const size = await openEditor(page);
    const card = page.getByLabel('Свойства');
    const before = await savePlan(page);

    // Своя перегородка, чтобы проём на ней был один и легко находился.
    await page.getByRole('button', { name: 'Перегородка', exact: true }).click();
    await clickAt(page, px(size, 0.45, 0.25));
    await clickAt(page, px(size, 0.45, 0.75));

    // Проём — клик по стене. Появляется сразу выделенным, шириной двери по
    // умолчанию: на плане у него нет ручки шире одной — только двигать вдоль
    // стены (D-267, п. 1).
    await page.getByRole('button', { name: 'Проём', exact: true }).click();
    const openingPoint = px(size, 0.45, 0.5);
    await clickAt(page, openingPoint);
    const withOpening = await savePlan(page);
    const opening = withOpening.openings.find(
      (entry) => !before.openings.some((old) => old.id === entry.id),
    );
    expect(opening).toBeDefined();
    await expect(card).toHaveAttribute('data-entity-id', opening!.id);
    expect(await card.getByLabel('Ширина, м').inputValue()).toBe('0.9');

    // Enter «завершает» проём — снимает выделение. Карточка «Свойства» без
    // выделения не рендерится вовсе (D-249), поэтому её и не остаётся на странице.
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Свойства')).toHaveCount(0);

    // Выбрать проём заново, чтобы проверить смену инструмента.
    await page.getByRole('button', { name: 'Выбор', exact: true }).click();
    await clickAt(page, openingPoint);
    await expect(card).toHaveAttribute('data-entity-id', opening!.id);

    // Заказ от 22.09: переключение на любой другой инструмент снимает
    // выделение с проёма так же, как Enter.
    await page.getByRole('button', { name: 'Зона', exact: true }).click();
    await expect(page.getByLabel('Свойства')).toHaveCount(0);
    await page.getByRole('button', { name: 'Выбор', exact: true }).click();

    // Ширина правится только карточкой; в плане длина стены больше 0,9 м.
    await clickAt(page, openingPoint);
    await expect(card).toHaveAttribute('data-entity-id', opening!.id);
    await card.getByLabel('Ширина, м').fill('1.4');
    const widened = await savePlan(page);
    expect(widened.openings.find((entry) => entry.id === opening!.id)?.width_m).toBeCloseTo(1.4, 6);

    // Шире собственной стены — отказ у самого поля, прежнее значение остаётся.
    await card.getByLabel('Ширина, м').fill('100');
    await expect(card.locator('.props__error')).toContainText('длины стены');
    const rejected = await savePlan(page);
    expect(rejected.openings.find((entry) => entry.id === opening!.id)?.width_m).toBeCloseTo(1.4, 6);

    expect(errors).toEqual([]);
  });

  test('свой контур помещения заменяет стены стартовой коробки, проём встаёт на новую стену', async ({ page }) => {
    // Находка operator'а 18.09: после «Помещение» стены и вход коробки 12×9
    // оставались на месте, проём на свой контур не ставился, а правило
    // «терминал ≤ 3 м от входа» считалось от входа вне помещения.
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const size = await openEditor(page);

    const before = await savePlan(page);
    expect(before.walls).toHaveLength(4);
    const oldIds = before.walls.map((w) => w.id);

    // L-образный контур внутри стартовой коробки.
    await drawRing(page, 'Помещение', [
      px(size, 0.15, 0.15),
      px(size, 0.7, 0.15),
      px(size, 0.7, 0.5),
      px(size, 0.45, 0.5),
      px(size, 0.45, 0.85),
      px(size, 0.15, 0.85),
    ]);
    // Пропажа входа названа в момент жеста, а не только находкой в «Проверке».
    await expect(page.getByTestId('plan-tools-notice')).toContainText(
      'Проёму не нашлось места',
    );
    await page.keyboard.press('Escape');

    const drawn = await savePlan(page);
    // Шесть рёбер — шесть стен, ни одной старой.
    expect(drawn.walls).toHaveLength(6);
    for (const w of drawn.walls) expect(oldIds).not.toContain(w.id);
    // Каждая стена лежит на ребре нового контура: концы совпадают с вершинами.
    const vertices = new Set(drawn.room.boundary.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`));
    for (const w of drawn.walls) {
      expect(vertices.has(`${w.from[0].toFixed(2)},${w.from[1].toFixed(2)}`)).toBe(true);
      expect(vertices.has(`${w.to[0].toFixed(2)},${w.to[1].toFixed(2)}`)).toBe(true);
    }
    // Новый контур не делит с коробкой ни одной вершины — это другое помещение,
    // и вход коробки в него не переезжает, а уходит вместе со своей стеной.
    expect(drawn.openings).toHaveLength(0);

    // Проём теперь ставится на свою стену: клик по середине верхнего ребра.
    await page.getByRole('button', { name: 'Проём', exact: true }).click();
    await clickAt(page, px(size, 0.42, 0.15));
    await page.getByRole('button', { name: 'Выбор', exact: true }).click();

    const withOpening = await savePlan(page);
    expect(withOpening.openings).toHaveLength(1);
    expect(drawn.walls.map((w) => w.id)).toContain(withOpening.openings[0]?.wallId);

    // Одно «Отменить» на контур: старые стены и вход возвращаются целиком.
    await page.getByRole('button', { name: 'Отменить' }).click();
    await page.getByRole('button', { name: 'Отменить' }).click();
    const undone = await savePlan(page);
    expect(undone.walls.map((w) => w.id).sort()).toEqual([...oldIds].sort());
    expect(undone.openings).toHaveLength(1);

    expect(errors).toEqual([]);
  });

  test('убранная вершина контура уносит вход — пропажа названа сразу', async ({ page }) => {
    // Тот же жест, но другой его исполнитель: контур правится ручками на
    // холсте, а не рисуется инструментом. Молчаливая пропажа единственного
    // входа — то же самое и здесь.
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openEditor(page);

    const before = await savePlan(page);
    expect(before.room.boundary).toHaveLength(4);
    expect(before.openings).toHaveLength(1);

    await page.getByRole('button', { name: 'Выбор', exact: true }).click();
    await clickAt(page, await worldPixel(page, 6, 4.5));
    await expect(page.getByText(/Контур: тяните вершину/)).toBeVisible();

    // Двойной клик по северо-западному углу (0, 9) убирает вершину: северного
    // ребра (12,9)→(0,9), на котором висит вход, у треугольника нет.
    await dblclickAt(page, await worldPixel(page, 0, 9));

    const after = await savePlan(page);
    expect(after.room.boundary).toHaveLength(3);
    expect(after.openings).toHaveLength(0);
    await expect(page.getByTestId('plan-tools-notice')).toContainText('Проёму не нашлось места');

    expect(errors).toEqual([]);
  });

  test('вставка вершины в контур помещения не сдвигает вход на другую стену', async ({ page }) => {
    // Ревью MR !64: перенос входа по номеру ребра ломался на этом жесте.
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const size = await openEditor(page);

    const before = await savePlan(page);
    const entrance = before.openings[0];
    if (entrance === undefined) throw new Error('в стартовом плане нет входа');
    const hostBefore = before.walls.find((w) => w.id === entrance.wallId);
    if (hostBefore === undefined) throw new Error('вход без стены');
    const y = hostBefore.from[1];
    expect(hostBefore.to[1]).toBe(y);
    expect(before.room.boundary).toHaveLength(4);

    // Выбрать помещение: клик по полу, подсказка контура появляется.
    await page.getByRole('button', { name: 'Выбор', exact: true }).click();
    await clickAt(page, px(size, 0.5, 0.5));
    await expect(page.getByText(/Контур: тяните вершину/)).toBeVisible();

    // Клик по ребру напротив стены со входом вставляет вершину — точка
    // берётся из сохранённого плана, а не подбором доли экрана: лаунчер
    // ассистента стоит посередине низа колонки и по клику снимает выделение
    // (D-258), а прежний перебор `fy` сверху вниз задевал его раньше, чем
    // добирался до настоящего ребра, и рисовать вершину было уже не на чем.
    const boundary = before.room.boundary;
    const oppositeEdge = boundary
      .map((point, index) => [point, boundary[(index + 1) % boundary.length]!] as const)
      .find(([a, b]) => a[1] === b[1] && a[1] !== y);
    if (oppositeEdge === undefined) throw new Error('нет ребра, отличного от стены входа');
    const midX = (oppositeEdge[0][0] + oppositeEdge[1][0]) / 2;
    await clickAt(page, await worldPixel(page, midX, oppositeEdge[0][1]));
    const boundaryAfter = (await savePlan(page)).room.boundary;
    expect(boundaryAfter).toHaveLength(5);

    const after = await savePlan(page);
    expect(after.walls).toHaveLength(5);
    const moved = after.openings.find((o) => o.id === entrance.id);
    expect(moved).toBeDefined();
    const hostAfter = after.walls.find((w) => w.id === moved?.wallId);
    expect(hostAfter).toBeDefined();
    // Вход остался на северной стене, а не уехал на восточную.
    expect(hostAfter?.from[1]).toBe(y);
    expect(hostAfter?.to[1]).toBe(y);

    expect(errors).toEqual([]);
  });

  test('маркер называет цель привязки до клика: зона, стена, сетка (D-224)', async ({ page }) => {
    await openEditor(page);

    // Зона в середине помещения, с Alt: её вершины ложатся туда, куда кликнули,
    // и не совпадают ни с гранями стен, ни с контуром.
    const corners: Point[] = [
      [2, 2],
      [5, 2],
      [5, 5],
      [2, 5],
    ];
    await page.getByRole('button', { name: 'Зона', exact: true }).click();
    await page.keyboard.down('Alt');
    for (const [x, y] of corners) await clickAt(page, await worldPixel(page, x, y));
    await clickAt(page, await worldPixel(page, corners[0]![0], corners[0]![1]));
    await page.keyboard.up('Alt');
    await page.keyboard.press('Escape');

    const drawn = await savePlan(page);
    const vertex = drawn.zones[0]?.polygon[0];
    if (vertex === undefined) throw new Error('зона не нарисована');

    // Инструмент рисования снова в руках — и под курсором видно, за что
    // зацепится следующая точка (находка operator 20.09 №5).
    await page.getByRole('button', { name: 'Зона', exact: true }).click();

    await hoverWorld(page, vertex[0] + 0.05, vertex[1] + 0.05);
    expect(await snapMarker(page)).toEqual({
      caption: 'X: зона · Y: зона',
      lines: ['snap-marker-x-zone', 'snap-marker-y-zone'],
    });

    // Тот же жест у стены: обводящий комнату видит «стена», а не «зона».
    await hoverWorld(page, 0.1, 0.1);
    expect(await snapMarker(page)).toEqual({
      caption: 'X: стена · Y: стена',
      lines: ['snap-marker-x-wall', 'snap-marker-y-wall'],
    });

    // Вдали от плана тянет только сетка — и линия у неё другая, пунктирная.
    await hoverWorld(page, 8.5, 7);
    expect(await snapMarker(page)).toEqual({
      caption: 'X: сетка 0,5 м · Y: сетка 0,5 м',
      lines: ['snap-marker-x-grid', 'snap-marker-y-grid'],
    });

    // Alt выключает привязку — значит и обещать нечего (D-208/D-215).
    await page.keyboard.down('Alt');
    await hoverWorld(page, vertex[0] + 0.05, vertex[1] + 0.05);
    await page.keyboard.up('Alt');
    expect(await snapMarker(page)).toEqual({ caption: '', lines: [] });

    // Escape бросает рисование вместе с маркером; смена инструмента — тоже.
    await hoverWorld(page, vertex[0] + 0.05, vertex[1] + 0.05);
    expect((await snapMarker(page)).lines).not.toEqual([]);
    await page.keyboard.press('Escape');
    expect(await snapMarker(page)).toEqual({ caption: '', lines: [] });

    await hoverWorld(page, vertex[0] + 0.05, vertex[1] + 0.05);
    expect((await snapMarker(page)).lines).not.toEqual([]);
    await page.getByRole('button', { name: 'Выбор', exact: true }).click();
    expect(await snapMarker(page)).toEqual({ caption: '', lines: [] });

    // Маркер — подсказка: ни один его кадр не попал ни в документ, ни в файл,
    // ни в историю (кнопка «Вернуть» гаснет только после новой правки).
    expect(await savePlan(page)).toEqual(drawn);
  });
});
