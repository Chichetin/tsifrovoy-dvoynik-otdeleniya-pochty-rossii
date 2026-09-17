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
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

type Point = [number, number];
type Pixel = { x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };

type SavedPlan = {
  room: { boundary: Point[] };
  walls: { id: string; from: Point; to: Point }[];
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

async function clickAt(page: Page, point: Pixel): Promise<void> {
  const target = await onPage(page, point);
  await page.mouse.click(target.x, target.y);
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

const areas = (page: Page): Locator => page.getByLabel('Площади');

async function roomArea(page: Page): Promise<string> {
  return ((await areas(page).locator('dd').first().textContent()) ?? '').trim();
}

async function zoneArea(page: Page, name: string): Promise<string> {
  const row = areas(page).locator('tbody tr', { hasText: name }).first();
  return ((await row.locator('td').nth(1).textContent()) ?? '').trim();
}

/** «12.34 м²» → 12.34: площадь нужна числом там, где сравнение с допуском. */
async function zoneAreaValue(page: Page, name: string): Promise<number> {
  return Number.parseFloat(await zoneArea(page, name));
}

async function savePlanFile(page: Page): Promise<string> {
  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Сохранить' }).click(),
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
): Promise<void> {
  await page.getByRole('button', { name: tool, exact: true }).click();
  for (const point of ring) await clickAt(page, point);
  const first = ring[0];
  if (first === undefined) throw new Error('пустой контур');
  await clickAt(page, first);
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

/** Помещение и две зоны: внешняя и нарисованная внутри неё вложенная. */
async function drawPlan(page: Page, size: Rect): Promise<void> {
  await drawRing(page, 'Помещение', ring(size, ROOM));
  await page.keyboard.press('Escape');
  await drawRing(page, 'Зона', ring(size, OUTER));
  await page.keyboard.press('Escape');
  await drawRing(page, 'Зона', ring(size, INNER));
  await page.keyboard.press('Escape');
}

test.describe('инструменты плана', () => {
  test('контур помещения и вложенной зоны правится на плане', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    const size = await openEditor(page);
    const card = page.getByLabel('Свойства');

    // Помещение из шаблона — 12 × 9 м; нарисованное считается по контуру.
    expect(await roomArea(page)).toBe('108.00 м²');
    await drawRing(page, 'Помещение', ring(size, ROOM));
    const drawnRoom = await roomArea(page);
    expect(drawnRoom).not.toBe('108.00 м²');

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
    await expect(card.getByTestId('props-id')).toHaveText('z_2');
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
    await page.getByRole('button', { name: 'Новый' }).click();
    await expect(page.getByText('Зоны ещё не размечены')).toBeVisible();

    await page.getByTestId('plan-file-input').setInputFiles(file);
    await expect.poll(() => zoneArea(page, 'Зона 2')).toBe(moved);
    expect(await roomArea(page)).not.toBe('108.00 м²');

    expect(errors).toEqual([]);
  });

  test('самопересечение отклоняется, а зона удаляется и возвращается отменой', async ({
    page,
  }, testInfo: TestInfo) => {
    const size = await openEditor(page);
    await drawPlan(page, size);

    await clickAt(page, px(size, 0.45, 0.45));
    const card = page.getByLabel('Свойства');
    await expect(card.getByTestId('props-id')).toHaveText('z_2');
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
    await expect(card.getByText('Выберите зону или объект на плане')).toBeVisible();

    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(areas(page).locator('tbody tr')).toHaveCount(2);
    expect(await zoneArea(page, 'Зона 2')).toBe(before);
  });

  test('проём и перегородка правятся, отмена сохраняет связь проёма со стеной', async ({
    page,
  }) => {
    const size = await openEditor(page);

    // Масштаб измеряется, а не вычисляется: два объекта в известных пикселях.
    const probe = async (fx: number, fy: number): Promise<{ pixel: Pixel; world: Point }> => {
      const pixel = px(size, fx, fy);
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
});
