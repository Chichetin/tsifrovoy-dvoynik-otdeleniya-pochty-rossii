/**
 * U04 в браузере: жесты над оборудованием.
 *
 * Обещания слоя: поворот и размер за ручки попадают в модель точно и при любом
 * zoom, один жест — одна команда и одно «Отменить», объект на скрытом слое не
 * выбирается и не удаляется, а масштаб никогда не остаётся в файле — только
 * `size_m`. Проверяется через карточку свойств и сохранённый JSON, не на глаз.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, exportPlan } from './fixtures';
import { validatePlan } from '../../src/domain/validation';
import { parsePlanDocument } from '../../src/contracts/schema';
import { importOrganizerExample } from '../../src/persistence/organizer-import';
import { showTab } from './side-tabs';

type Screen = { x: number; y: number };
type Calibration = { scale: number; origin: Screen };

const RACK = 'Шкаф / стеллаж для посылок';
/** Зазор ручки поворота от передней кромки, как в EquipmentLayer. */
const ROTATION_GAP_PX = 28;

const card = (page: Page) => page.getByLabel('Свойства');
const inventoryRows = (page: Page) =>
  page.getByLabel('Инвентаризация').locator('table').first().locator('tbody tr');

/**
 * Konva рисует сцену и hit-canvas в requestAnimationFrame после коммита React;
 * под нагрузкой указатель успевает раньше кадра и «не находит» свежую ручку.
 * Два кадра — гарантия, что запрошенная перерисовка уже прошла.
 */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function clickCanvas(page: Page, x: number, y: number): Promise<void> {
  await settle(page);
  await page.getByTestId('editor-canvas').click({ position: { x, y } });
}

async function placeFromLibrary(page: Page, label: string, x: number, y: number): Promise<void> {
  await showTab(page, 'Библиотека');
  await page.locator('.library__item', { hasText: label }).first().click();
  await clickCanvas(page, x, y);
  await page.getByRole('button', { name: 'Выбор', exact: true }).click();
}

async function dragFromLibrary(page: Page, label: string, x: number, y: number): Promise<void> {
  await page.locator('.library__item', { hasText: label }).first().dragTo(page.getByTestId('editor-canvas'), {
    targetPosition: { x, y },
  });
}

/** Выбор по строке перечня: не зависит от попадания мышью в фигуру. */
async function selectRow(page: Page, index: number): Promise<void> {
  // После выбора на плане справа только «Свойства»: вкладка возвращает перечень.
  const tab = page.getByRole('tab', { name: /^Инвентаризация/ });
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
  await inventoryRows(page).nth(index).getByRole('button').first().click();
}

async function selectByLabel(page: Page, label: string): Promise<void> {
  await showTab(page, 'Инвентаризация');
  await page.getByLabel('Инвентаризация').locator('.table__link', { hasText: label }).first().click();
}

async function numberOf(page: Page, label: string): Promise<number> {
  return Number(await card(page).getByLabel(label).inputValue());
}

async function savePlan(page: Page): Promise<string> {
  const download = await Promise.all([
    page.waitForEvent('download'),
    exportPlan(page, 'JSON'),
  ]).then(([event]) => event);
  const path = await download.path();
  expect(path).not.toBeNull();
  return readFileSync(path as string, 'utf8');
}

async function newPlan(page: Page): Promise<void> {
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Создать новый' }).click();
  await expect(page.getByText('Оборудование ещё не размещено')).toBeVisible();
}

/** Координата на странице для точки холста. */
async function onPage(page: Page, point: Screen): Promise<Screen> {
  const box = await page.getByTestId('editor-canvas').boundingBox();
  if (box === null) throw new Error('холст не виден');
  return { x: box.x + point.x, y: box.y + point.y };
}

async function drag(
  page: Page,
  from: Screen,
  to: Screen,
  options: { shift?: boolean; alt?: boolean; escape?: boolean } = {},
): Promise<void> {
  const start = await onPage(page, from);
  const end = await onPage(page, to);
  if (options.shift) await page.keyboard.down('Shift');
  // Alt на время жеста выключает привязку (D-208): перенос ложится ровно под курсор.
  if (options.alt) await page.keyboard.down('Alt');
  await settle(page);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 3, start.y + 3);
  await page.mouse.move(end.x, end.y, { steps: 8 });
  // Escape до отпускания кнопки: жест отменяется на полпути.
  if (options.escape) await page.keyboard.press('Escape');
  await page.mouse.up();
  if (options.alt) await page.keyboard.up('Alt');
  if (options.shift) await page.keyboard.up('Shift');
}

/**
 * Масштаб и начало координат холста — из того, что холст сам публикует о
 * текущем виде (`data-visible`: видимый кусок мира в метрах).
 *
 * Раньше калибровка ставила два объекта и считала масштаб по их карточкам, но
 * такой замер живёт до первой смены вида, а открытый файл теперь вписывается в
 * холст (U02). Поэтому вид спрашивается после того, как план открыт.
 */
async function canvasView(page: Page): Promise<Calibration> {
  const canvas = page.getByTestId('editor-canvas');
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('холст не виден');
  const raw = await canvas.getAttribute('data-visible');
  if (raw === null) throw new Error('холст не сообщил видимую область');
  const [minX, minY, maxX] = raw.split(',').map(Number) as [number, number, number];
  const scale = box.width / (maxX - minX);
  return { scale, origin: { x: -minX * scale, y: box.height + minY * scale } };
}

function toScreen(view: Calibration, x: number, y: number): Screen {
  return { x: view.origin.x + x * view.scale, y: view.origin.y - y * view.scale };
}

/** Ручка поворота: перед передней кромкой объекта, повёрнутого на `deg`. */
function rotationHandle(centre: Screen, depth_m: number, scale: number, deg: number): Screen {
  const reach = (depth_m / 2) * scale + ROTATION_GAP_PX;
  const rad = (deg * Math.PI) / 180;
  // На экране Y вниз: «вперёд» при 0° — вверх, положительный угол — по часовой.
  return { x: centre.x + reach * Math.sin(rad), y: centre.y - reach * Math.cos(rad) };
}

/** Масштаб холста из подписи «px/м»: округлён до целого, для одиночных проверок хватает. */
async function shownScale(page: Page): Promise<number> {
  const text = (await page.getByTestId('canvas-scale').textContent()) ?? '';
  const match = /(\d+) px\/м/.exec(text);
  if (match === null) throw new Error(`нет масштаба в «${text}»`);
  return Number(match[1]);
}

/** Пиксели цвета подписи (#212529) внутри прямоугольника холста, по всем слоям сцены. */
async function captionPixels(page: Page, box: { x: number; y: number; w: number; h: number }): Promise<number> {
  return page.evaluate((b) => {
    let count = 0;
    for (const canvas of document.querySelectorAll<HTMLCanvasElement>('.editor-canvas canvas')) {
      const context = canvas.getContext('2d');
      if (context === null) continue;
      const ratio = canvas.width / canvas.clientWidth;
      const { data } = context.getImageData(
        Math.round(b.x * ratio), Math.round(b.y * ratio), Math.round(b.w * ratio), Math.round(b.h * ratio),
      );
      for (let i = 0; i < data.length; i += 4) {
        if ((data[i + 3] ?? 0) > 200 && (data[i] ?? 255) <= 90 && (data[i + 1] ?? 255) <= 90 && (data[i + 2] ?? 255) <= 90) {
          count += 1;
        }
      }
    }
    return count;
  }, box);
}

/** Число очисток canvas по слоям сцены (по имени Konva-слоя) с момента вызова. */
async function armLayerClearCounter(page: Page): Promise<void> {
  await page.evaluate(() => {
    const konva = (window as unknown as { Konva?: { stages: { getLayers(): { name(): string; getCanvas(): { _canvas: HTMLCanvasElement } }[] }[] } }).Konva;
    if (konva === undefined) throw new Error('Konva не найден в window');
    const counts: Record<string, number> = {};
    (window as unknown as { __layerClears: Record<string, number> }).__layerClears = counts;
    for (const stage of konva.stages) {
      for (const layer of stage.getLayers()) {
        const context = layer.getCanvas()._canvas.getContext('2d');
        if (context === null) continue;
        const original = context.clearRect.bind(context);
        const name = layer.name() || 'unnamed';
        counts[name] = 0;
        context.clearRect = (...args: [number, number, number, number]) => {
          counts[name] = (counts[name] ?? 0) + 1;
          return original(...args);
        };
      }
    }
  });
}

test.describe('жесты над оборудованием', () => {
  test('оборудование можно перетащить из библиотеки прямо на план', async ({ page }) => {
    await page.goto('/');

    await dragFromLibrary(page, RACK, 330, 260);

    await expect(inventoryRows(page)).toHaveCount(1);
    await expect(inventoryRows(page).first()).toContainText(RACK);
    await expect(page.locator('.library__item', { hasText: RACK }).first()).toHaveAttribute('aria-pressed', 'false');
    await expect(card(page)).toContainText(RACK);
  });

  test('наведение показывает паспорт объекта и связанную находку проверки', async ({ page }) => {
    const raw: unknown = JSON.parse(readFileSync(join(process.cwd(), 'demo', 'before.json'), 'utf8'));
    const parsed = parsePlanDocument(raw);
    if (!parsed.ok) throw new Error('demo/before.json не разобрался');
    const issue = validatePlan(parsed.value).find((entry) =>
      entry.refs.some((ref) => ref.kind === 'object'),
    );
    const ref = issue?.refs.find((entry) => entry.kind === 'object');
    const object = parsed.value.objects.find((entry) => entry.id === ref?.id);
    if (issue === undefined || object === undefined) throw new Error('В демо нет находки по объекту');

    await page.goto('/');
    await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'demo', 'before.json'));
    await expect(inventoryRows(page)).toHaveCount(53);
    const point = toScreen(await canvasView(page), object.position[0], object.position[1]);
    const pagePoint = await onPage(page, point);
    await page.mouse.move(0, 0);
    await page.mouse.move(pagePoint.x, pagePoint.y);

    await expect.poll(() => page.evaluate(() => {
      type Node = { visible(): boolean; findOne(selector: string): { text(): string } | undefined };
      const stage = (window as unknown as { Konva?: { stages: { findOne(selector: string): Node | undefined }[] } }).Konva?.stages[0];
      const label = stage?.findOne('.equipment-hover');
      return { visible: label?.visible() ?? false, text: label?.findOne('Text')?.text() ?? '' };
    })).toMatchObject({ visible: true });
    const text = await page.evaluate(() => {
      type Node = { findOne(selector: string): { text(): string } | undefined };
      const stage = (window as unknown as { Konva: { stages: { findOne(selector: string): Node }[] } }).Konva.stages[0]!;
      return stage.findOne('.equipment-hover').findOne('Text')?.text() ?? '';
    });
    expect(text).toContain(object.label);
    expect(text).toContain(`ID: ${object.id}`);
    expect(text).toContain('Размер:');
    expect(text).toContain('Поворот:');
    expect(text).toContain(`Проверка: ${issue.message}`);

    await page.mouse.move(0, 0);
    await expect.poll(() => page.evaluate(() => {
      type Node = { visible(): boolean };
      const stage = (window as unknown as { Konva: { stages: { findOne(selector: string): Node }[] } }).Konva.stages[0]!;
      return stage.findOne('.equipment-hover').visible();
    })).toBe(false);
  });

  test('клик в перечне не перерисовывает слой оборудования (D-177)', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'demo', 'before.json'));
    await expect(inventoryRows(page)).toHaveCount(53);
    await armLayerClearCounter(page);
    await selectRow(page, 0);
    await expect(card(page).getByTestId('props-id')).toHaveText(/^eq_/);
    await page.waitForTimeout(300);
    const clears = await page.evaluate(
      () => (window as unknown as { __layerClears: Record<string, number> }).__layerClears,
    );
    // Выделение и фокус перерисовываются, тысяча фигур — нет.
    expect(clears.equipment).toBe(0);
    expect(clears['equipment-selection']).toBeGreaterThan(0);
  });

  test('после удаления объект ставится снова: удалённый id не переиспользуется, но и не мешает', async ({
    page,
  }) => {
    await page.goto('/');
    await placeFromLibrary(page, RACK, 420, 330);
    await expect(inventoryRows(page)).toHaveCount(1);
    await selectRow(page, 0);
    await page.keyboard.press('Delete');
    await expect(inventoryRows(page)).toHaveCount(0);

    await placeFromLibrary(page, RACK, 300, 260);
    await expect(inventoryRows(page)).toHaveCount(1);
    await expect(page.locator('.shell__error')).toHaveCount(0);
    await selectRow(page, 0);
    await expect(card(page).getByTestId('props-id')).toHaveText('eq_2');
  });

  test('объект подписан на холсте своим названием, без клика', async ({ page }) => {
    await page.goto('/');
    const centre: Screen = { x: 420, y: 330 };
    await placeFromLibrary(page, RACK, centre.x, centre.y);
    await expect(inventoryRows(page)).toHaveCount(1);
    const scale = await shownScale(page);
    const w = 1.2 * scale;
    const h = 0.5 * scale;
    expect(w).toBeGreaterThanOrEqual(44);
    // Внутренняя часть следа, без обводки: тёмные пиксели здесь — только текст.
    const box = { x: centre.x - w / 2 + 4, y: centre.y - h / 2 + 4, w: w - 8, h: h - 8 };
    await expect.poll(() => captionPixels(page, box)).toBeGreaterThan(30);
  });

  test('повторный клик по активному типу отменяет установку', async ({ page }) => {
    await page.goto('/');
    await showTab(page, 'Библиотека');
    const libraryItem = page.locator('.library__item', { hasText: RACK }).first();
    await libraryItem.click();
    await expect(libraryItem).toHaveAttribute('aria-pressed', 'true');

    await libraryItem.click();
    await expect(libraryItem).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('button', { name: 'Выбор', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await clickCanvas(page, 420, 330);
    await expect(inventoryRows(page)).toHaveCount(0);
  });
  test('установка одноразовая, а повторный клик по такому же выбирает без дубля', async ({
    page,
  }) => {
    await page.goto('/');
    await showTab(page, 'Библиотека');
    const libraryItem = page.locator('.library__item', { hasText: RACK }).first();
    await libraryItem.click();
    await expect(libraryItem).toHaveAttribute('aria-pressed', 'true');
    await expect(libraryItem).toHaveClass(/is-selected/);
    const centre: Screen = { x: 420, y: 330 };
    await clickCanvas(page, centre.x, centre.y);
    // Карточка сразу показывает новый объект, а инструмент вернулся к выбору.
    await expect(card(page).getByTestId('props-id')).toHaveText('eq_1');
    await expect(page.getByRole('button', { name: 'Выбор', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(libraryItem).toHaveAttribute('aria-pressed', 'false');
    await expect(libraryItem).not.toHaveClass(/is-selected/);

    // Клик по плану после установки работает с выбранным объектом и не создаёт
    // ещё один, даже если приходится на его ручку поворота.
    const depth = await numberOf(page, 'Глубина, м');
    const scale = await shownScale(page);
    const handle = rotationHandle(centre, depth, scale, 0);
    await clickCanvas(page, handle.x, handle.y);
    await expect(inventoryRows(page)).toHaveCount(1);

    // Повторная установка требует явного нового выбора типа.
    await libraryItem.click();
    await expect(libraryItem).toHaveAttribute('aria-pressed', 'true');
    await clickCanvas(page, 300, 260);
    await expect(card(page).getByTestId('props-id')).toHaveText('eq_2');
    await expect(inventoryRows(page)).toHaveCount(2);
    await libraryItem.click();
    await expect(libraryItem).toHaveAttribute('aria-pressed', 'true');
    // Тот же тип уже стоит под указателем: выбираем существующий, не кладём дубль.
    await clickCanvas(page, centre.x, centre.y);
    await expect(card(page).getByTestId('props-id')).toHaveText('eq_1');
    await expect(inventoryRows(page)).toHaveCount(2);

    // В 7 px за левой гранью — всё ещё тот же объект. Сначала уводим выбор,
    // затем снова берём тот же тип из библиотеки, чтобы результат был наблюдаем.
    await selectRow(page, 1);
    await expect(libraryItem).toHaveAttribute('aria-pressed', 'true');
    const width = await numberOf(page, 'Ширина, м');
    const nearLeft = centre.x - (width * scale) / 2 - 7;
    await clickCanvas(page, nearLeft, centre.y);
    await expect(card(page).getByTestId('props-id')).toHaveText('eq_1');
    await expect(inventoryRows(page)).toHaveCount(2);

    // За пределами допуска постановка продолжается тем же активным инструментом.
    await clickCanvas(page, nearLeft - 4, centre.y);
    await expect(card(page).getByTestId('props-id')).toHaveText('eq_3');
    await expect(inventoryRows(page)).toHaveCount(3);
  });

  test('сразу после установки выбранный объект можно перетащить', async ({ page }) => {
    await page.goto('/');
    const centre: Screen = { x: 420, y: 330 };
    await showTab(page, 'Библиотека');
    await page.locator('.library__item', { hasText: RACK }).first().click();
    await clickCanvas(page, centre.x, centre.y);
    await expect(card(page).getByTestId('props-id')).toHaveText('eq_1');
    const x0 = await numberOf(page, 'X, м');
    const width0 = await numberOf(page, 'Ширина, м');
    const depth0 = await numberOf(page, 'Глубина, м');

    // Никакого дополнительного клика «Выбор»: успешная постановка сама
    // возвращает инструмент в режим редактирования. У стеллажа глубина на
    // экране меньше диаметра обычных ручек: центральный захват обязан всё
    // равно переносить объект, а не менять его размер.
    await drag(page, centre, { x: centre.x + 120, y: centre.y });
    await expect.poll(() => numberOf(page, 'X, м')).toBeGreaterThan(x0 + 0.5);
    expect(await numberOf(page, 'Ширина, м')).toBe(width0);
    expect(await numberOf(page, 'Глубина, м')).toBe(depth0);
    await expect(inventoryRows(page)).toHaveCount(1);
  });

  test('отклонённая установка оставляет тип активным для повторной попытки', async ({ page }) => {
    await page.goto('/');
    await showTab(page, 'Слои');
    await page.getByRole('button', { name: 'Запереть слой Основной' }).click();
    await showTab(page, 'Библиотека');
    const libraryItem = page.locator('.library__item', { hasText: RACK }).first();
    await libraryItem.click();
    await clickCanvas(page, 420, 330);

    await expect(page.getByRole('alert')).toContainText('заперт');
    await expect(inventoryRows(page)).toHaveCount(0);
    await expect(libraryItem).toHaveAttribute('aria-pressed', 'true');
    await expect(libraryItem).toHaveClass(/is-selected/);
  });

  test('поворот за ручку: 90° с Shift, свободный 37°, одно «Отменить» на жест', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');

    const centre: Screen = { x: 420, y: 330 };
    await placeFromLibrary(page, RACK, centre.x, centre.y);
    await selectRow(page, 0);
    await expect(card(page).getByLabel('Поворот, °')).toHaveValue('0');
    const depth = await numberOf(page, 'Глубина, м');
    const scale = await shownScale(page);

    // Shift: указатель чуть выше горизонтали, ручка прилипает к 90.
    await drag(page, rotationHandle(centre, depth, scale, 0), { x: centre.x + 160, y: centre.y - 12 }, {
      shift: true,
    });
    await expect(card(page).getByLabel('Поворот, °')).toHaveValue('90');
    expect(JSON.parse(await savePlan(page)).objects[0].rotation_deg).toBe(90);

    // Без Shift: направление на 37° по часовой от «вперёд».
    const rad = (37 * Math.PI) / 180;
    await drag(page, rotationHandle(centre, depth, scale, 90), {
      x: centre.x + 160 * Math.sin(rad),
      y: centre.y - 160 * Math.cos(rad),
    });
    const free = await numberOf(page, 'Поворот, °');
    expect(Math.abs(free - 37)).toBeLessThanOrEqual(0.3);

    // Каждый жест — один шаг истории, сколько бы кадров он ни занял.
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(card(page).getByLabel('Поворот, °')).toHaveValue('90');
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(card(page).getByLabel('Поворот, °')).toHaveValue('0');

    expect(errors).toEqual([]);
  });

  test('размер за ручку пишется в size_m, масштаба в файле нет, одно «Отменить»', async ({ page }) => {
    await page.goto('/');
    const centre: Screen = { x: 420, y: 330 };
    await placeFromLibrary(page, RACK, centre.x, centre.y);
    await selectRow(page, 0);
    const width = await numberOf(page, 'Ширина, м');
    const depth = await numberOf(page, 'Глубина, м');
    const x0 = await numberOf(page, 'X, м');
    const scale = await shownScale(page);

    // Восточная ручка на правой кромке; тянем на 100 px вправо.
    const east: Screen = { x: centre.x + (width / 2) * scale, y: centre.y };
    await drag(page, east, { x: east.x + 100, y: east.y });

    const grown = 100 / scale;
    expect(Math.abs((await numberOf(page, 'Ширина, м')) - (width + grown))).toBeLessThanOrEqual(0.05);
    expect(await numberOf(page, 'Глубина, м')).toBe(depth);
    // Противоположная кромка стоит на месте: центр уехал на половину прироста.
    expect(Math.abs((await numberOf(page, 'X, м')) - (x0 + grown / 2))).toBeLessThanOrEqual(0.05);
    await expect(card(page).getByLabel('Поворот, °')).toHaveValue('0');

    const saved = JSON.parse(await savePlan(page)).objects[0];
    expect(saved.size_m[0]).toBeCloseTo(await numberOf(page, 'Ширина, м'), 6);
    expect(saved.size_m[1]).toBe(depth);
    expect(Object.keys(saved)).not.toEqual(expect.arrayContaining(['scale', 'scaleX', 'scaleY']));

    await page.getByRole('button', { name: 'Отменить' }).click();
    expect(await numberOf(page, 'Ширина, м')).toBe(width);
    expect(await numberOf(page, 'X, м')).toBe(x0);
  });

  test('перенос после zoom попадает в модель: считается в метрах, не в пикселях', async ({ page }) => {
    await page.goto('/');
    const centre: Screen = { x: 420, y: 330 };
    await placeFromLibrary(page, RACK, centre.x, centre.y);
    await selectRow(page, 0);
    const x0 = await numberOf(page, 'X, м');
    const y0 = await numberOf(page, 'Y, м');
    const before = await shownScale(page);

    // Колесо над центром объекта: точка под курсором остаётся под курсором.
    const at = await onPage(page, centre);
    await page.mouse.move(at.x, at.y);
    await page.mouse.wheel(0, -400);
    await expect
      .poll(async () => shownScale(page), { message: 'масштаб после колеса' })
      .toBeGreaterThan(before * 2);
    const scale = await shownScale(page);

    await drag(page, centre, { x: centre.x + 120, y: centre.y - 60 }, { alt: true });
    expect(Math.abs((await numberOf(page, 'X, м')) - (x0 + 120 / scale))).toBeLessThanOrEqual(0.05);
    expect(Math.abs((await numberOf(page, 'Y, м')) - (y0 + 60 / scale))).toBeLessThanOrEqual(0.05);

    await page.getByRole('button', { name: 'Отменить' }).click();
    expect(await numberOf(page, 'X, м')).toBe(x0);
    expect(await numberOf(page, 'Y, м')).toBe(y0);
  });

  test('перенос притягивает грань к грани соседа, Alt отключает привязку (D-208)', async ({ page }) => {
    await page.goto('/');
    const left: Screen = { x: 300, y: 330 };
    const right: Screen = { x: 520, y: 330 };
    await placeFromLibrary(page, RACK, left.x, left.y);
    await placeFromLibrary(page, RACK, right.x, right.y);
    await selectRow(page, 0);
    const leftX = await numberOf(page, 'X, м');
    const width = await numberOf(page, 'Ширина, м');
    await selectRow(page, 1);
    const rightXBefore = await numberOf(page, 'X, м');
    const rightYBefore = await numberOf(page, 'Y, м');
    await selectRow(page, 0);
    const scale = await shownScale(page);
    // Правый стеллаж оказывается на 5 px правее, чем «впритык» к левому: в допуске 8 px.
    const flush = right.x - ((right.x - left.x) / scale - width) * scale;
    const target: Screen = { x: flush + 5, y: right.y };

    // Пока стеллаж тянут, на холсте видна линия направляющей — грань соседа
    // (operator 20.09 №3); после броска её нет.
    const snapLine = () =>
      page.evaluate(() => {
        type Node = { findOne(selector: string): unknown };
        const stage = (window as unknown as { Konva?: { stages: Node[] } }).Konva?.stages[0];
        return stage?.findOne('.snap-line-x-guide') !== undefined;
      });
    const start = await onPage(page, right);
    const end = await onPage(page, target);
    await settle(page);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 3, start.y + 3);
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await expect.poll(snapLine).toBe(true);
    // Карточка следует за рукой до mouseup: документ и история ещё не менялись.
    await expect.poll(() => numberOf(page, 'X, м')).toBeCloseTo(leftX + width, 6);
    await expect.poll(() => numberOf(page, 'Y, м')).toBeCloseTo(rightYBefore, 6);
    expect(Math.abs((await numberOf(page, 'X, м')) - rightXBefore)).toBeGreaterThan(0.05);
    await page.mouse.up();
    await expect.poll(snapLine).toBe(false);
    await selectRow(page, 1);
    // Левая грань правого стеллажа легла ровно на правую грань левого.
    expect((await numberOf(page, 'X, м')) - width / 2).toBeCloseTo(leftX + width / 2, 6);

    await page.getByRole('button', { name: 'Отменить' }).click();
    await drag(page, right, target, { alt: true });
    await selectRow(page, 1);
    const gap = (await numberOf(page, 'X, м')) - width / 2 - (leftX + width / 2);
    // Без привязки остался зазор в те самые ~5 px.
    expect(gap).toBeGreaterThan(2 / scale);
    expect(gap).toBeLessThan(8 / scale);
  });

  test('впритык к стене — на грань стены, не в стену: находки «пересекает стену» нет (D-211)', async ({ page }) => {
    await page.goto('/');
    const before = JSON.parse(await savePlan(page)) as {
      room: { boundary: [number, number][] };
      walls: { thickness_m: number }[];
    };
    const east = Math.max(...before.room.boundary.map((vertex) => vertex[0]));
    const face = east - (before.walls[0]?.thickness_m ?? 0) / 2;
    const centre: Screen = { x: 420, y: 330 };
    await placeFromLibrary(page, RACK, centre.x, centre.y);
    await selectRow(page, 0);
    const width = await numberOf(page, 'Ширина, м');
    const view = await canvasView(page);
    const y = await numberOf(page, 'Y, м');
    // Правая грань в 4 px от внутренней грани стены — в допуске привязки.
    const target = toScreen(view, face - width / 2, y);
    await drag(page, centre, { x: target.x - 4, y: target.y });
    await selectRow(page, 0);
    // Грань стены 14,875 хранится как есть, а не округляется в стену (14,88).
    expect((await numberOf(page, 'X, м')) + width / 2).toBeCloseTo(face, 9);
    await showTab(page, 'Проверка');
    await expect(page.getByLabel('Проверка плана')).not.toContainText('пересекает стену');
  });

  test('скрытый слой: объект не выбирается и не удаляется, пока слой не показан', async ({ page }) => {
    await page.goto('/');
    const centre: Screen = { x: 420, y: 330 };
    await placeFromLibrary(page, RACK, centre.x, centre.y);
    await expect(inventoryRows(page)).toHaveCount(1);

    await showTab(page, 'Слои');
    await page.getByRole('button', { name: 'Показывать слой Основной' }).click();
    await clickCanvas(page, centre.x, centre.y);
    // Клик прошёл сквозь невидимый объект и выбрал пол под ним — помещение, а не eq_1.
    await expect(card(page).getByTestId('props-id')).toHaveText('room_main');
    await page.keyboard.press('Delete');
    await expect(inventoryRows(page)).toHaveCount(1);

    // Выбор через перечень возможен, но ручек и удаления у невидимого объекта нет.
    await selectRow(page, 0);
    await page.keyboard.press('Delete');
    await expect(inventoryRows(page)).toHaveCount(1);

    await showTab(page, 'Слои');
    await page.getByRole('button', { name: 'Показывать слой Основной' }).click();
    await clickCanvas(page, centre.x, centre.y);
    await expect(card(page).getByTestId('props-id')).toHaveText('eq_1');
    await page.keyboard.press('Delete');
    await expect(page.getByText('Оборудование ещё не размещено')).toBeVisible();

    // Клавиша в поле карточки — это правка поля, а не удаление объекта.
    await page.getByRole('button', { name: 'Отменить' }).click();
    await selectRow(page, 0);
    await card(page).getByLabel('Название').focus();
    await page.keyboard.press('Backspace');
    await expect(inventoryRows(page)).toHaveCount(1);
  });

  test('Escape отменяет жест: команды нет, объект на месте, выделение остаётся', async ({
    page,
  }) => {
    await page.goto('/');
    const centre: Screen = { x: 420, y: 330 };
    await placeFromLibrary(page, RACK, centre.x, centre.y);
    await selectRow(page, 0);
    const x0 = await numberOf(page, 'X, м');
    const y0 = await numberOf(page, 'Y, м');

    await drag(page, centre, { x: centre.x + 140, y: centre.y - 70 }, { escape: true });

    // Выделение принадлежит объекту, а не холсту: карточка отменённого
    // объекта остаётся открытой.
    await expect(card(page).getByTestId('props-id')).toHaveText('eq_1');
    expect(await numberOf(page, 'X, м')).toBe(x0);
    expect(await numberOf(page, 'Y, м')).toBe(y0);

    // Команды не было: единственный шаг истории — постановка объекта.
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(page.getByText('Оборудование ещё не размещено')).toBeVisible();
  });

  test('размер считается от точки захвата ручки, а не от промаха по ней', async ({ page }) => {
    await page.goto('/');
    const centre: Screen = { x: 420, y: 330 };
    await placeFromLibrary(page, RACK, centre.x, centre.y);
    await selectRow(page, 0);
    const width = await numberOf(page, 'Ширина, м');
    const scale = await shownScale(page);

    // Нажимаем на 5 px правее центра восточной ручки — ручка радиусом 6 px
    // это ловит, и эти 5 px не должны прибавиться к ширине.
    const miss = 5;
    const east: Screen = { x: centre.x + (width / 2) * scale + miss, y: centre.y };
    await drag(page, east, { x: east.x + 100, y: east.y });

    const grown = await numberOf(page, 'Ширина, м');
    expect(Math.abs(grown - (width + 100 / scale))).toBeLessThanOrEqual(0.04);
    // Прежнее поведение дало бы +105 px: ручка прыгала на промах захвата.
    expect(grown).toBeLessThan(width + (100 + miss) / scale);
  });

  test('запертый слой: Delete не удаляет объект и объясняет отказ', async ({ page }) => {
    await page.goto('/');
    const centre: Screen = { x: 420, y: 330 };
    await placeFromLibrary(page, RACK, centre.x, centre.y);
    await selectRow(page, 0);
    await showTab(page, 'Слои');
    await page.getByRole('button', { name: 'Запереть слой Основной' }).click();

    await page.keyboard.press('Delete');
    await expect(page.getByRole('alert')).toContainText('заперт');
    await expect(inventoryRows(page)).toHaveCount(1);

    // Замок снят той же кнопкой — и та же клавиша удаляет.
    await showTab(page, 'Слои');
    await page.getByRole('button', { name: 'Запереть слой Основной' }).click();
    await selectRow(page, 0);
    await page.keyboard.press('Delete');
    await expect(page.getByText('Оборудование ещё не размещено')).toBeVisible();
  });

  test('запертый слой: объект выбирается, но ручек нет и он не тянется', async ({ page }) => {
    await page.goto('/');
    const centre: Screen = { x: 420, y: 330 };
    await placeFromLibrary(page, RACK, centre.x, centre.y);
    await selectRow(page, 0);
    const x0 = await numberOf(page, 'X, м');
    await showTab(page, 'Слои');
    await page.getByRole('button', { name: 'Запереть слой Основной' }).click();

    await drag(page, centre, { x: centre.x + 100, y: centre.y });
    await clickCanvas(page, centre.x, centre.y);
    await expect(card(page).getByTestId('props-id')).toHaveText('eq_1');
    expect(await numberOf(page, 'X, м')).toBe(x0);
  });

  test('пример организаторов: повернуть стеллаж на 90°, сохранить, открыть заново', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');

    // Пример лежит в формате организаторов; в формат редактора его переводит
    // тот же импортёр, что и в unit-тестах.
    const source = JSON.parse(readFileSync(join(process.cwd(), 'example_plan.json'), 'utf8'));
    const imported = importOrganizerExample(source);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    await page.getByTestId('plan-file-input').setInputFiles({
      name: 'example_plan.editor.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(imported.value)),
    });
    await expect(page.getByTestId('files-notice')).toContainText('открыт');

    // Вид спрашивается после открытия файла: холст уже вписал в себя план.
    const view = await canvasView(page);

    await selectByLabel(page, 'Стеллаж посылок');
    await expect(card(page).getByTestId('props-id')).toHaveText('eq_rack_1');
    await expect(card(page).getByLabel('Поворот, °')).toHaveValue('0');
    const centre = toScreen(view, await numberOf(page, 'X, м'), await numberOf(page, 'Y, м'));
    const depth = await numberOf(page, 'Глубина, м');

    await drag(page, rotationHandle(centre, depth, view.scale, 0), { x: centre.x + 150, y: centre.y - 10 }, {
      shift: true,
    });
    await expect(card(page).getByLabel('Поворот, °')).toHaveValue('90');

    const text = await savePlan(page);
    const rack = JSON.parse(text).objects.find((entry: { id: string }) => entry.id === 'eq_rack_1');
    expect(rack.rotation_deg).toBe(90);

    await newPlan(page);
    await page.getByTestId('plan-file-input').setInputFiles({
      name: 'example_plan.rotated.json',
      mimeType: 'application/json',
      buffer: Buffer.from(text),
    });
    await selectByLabel(page, 'Стеллаж посылок');
    await expect(card(page).getByTestId('props-id')).toHaveText('eq_rack_1');
    await expect(card(page).getByLabel('Поворот, °')).toHaveValue('90');

    expect(errors).toEqual([]);
  });
});
