/**
 * V02 (маркеры): находки проверки видны на плане без клика (operator №10, D-157).
 *
 * Фигуры холста — не DOM, поэтому маркеры читаются через Konva: узел
 * `name="issue-marker"` с `id` вида `issue-marker:<kind>:<id>` и атрибутами
 * `issueCount`, `severity`, `focused`. Сверка идёт со списком «Проверка»: у
 * каждой находки первая ссылка — сущность, которую она помечает на плане.
 */

import { join } from 'node:path';
import { expect, test, type Locator, type Page } from './fixtures';
import { showTab, sideTab } from './side-tabs';

const EXAMPLE = join(process.cwd(), 'example_plan.json');

type MarkerView = { id: string; count: number; severity: string; focused: boolean; radius: number };

async function markers(page: Page): Promise<MarkerView[]> {
  return page.evaluate(() => {
    type KonvaNode = {
      id(): string;
      getAttr(name: string): unknown;
      findOne(selector: string): { radius(): number } | undefined;
    };
    type KonvaGlobal = { stages: { find(selector: string): KonvaNode[] }[] };
    const konva = (window as unknown as { Konva?: KonvaGlobal }).Konva;
    const stage = konva?.stages[0];
    if (stage === undefined) return [];
    return stage.find('.issue-marker').map((node) => ({
      id: node.id(),
      count: Number(node.getAttr('issueCount')),
      severity: String(node.getAttr('severity')),
      focused: node.getAttr('focused') === true,
      radius: node.findOne('Circle')?.radius() ?? 0,
    }));
  });
}

type ScreenPoint = { x: number; y: number };

/** Центр фигуры Konva с этим именем, в пикселях холста (без смещения страницы). */
async function nodeCentre(page: Page, selector: string): Promise<ScreenPoint | null> {
  return page.evaluate((sel) => {
    type Rect = { x: number; y: number; width: number; height: number };
    type KonvaNode = { getClientRect: () => Rect };
    type KonvaGlobal = { stages: { findOne(selector: string): KonvaNode | undefined }[] };
    const konva = (window as unknown as { Konva?: KonvaGlobal }).Konva;
    const rect = konva?.stages[0]?.findOne(sel)?.getClientRect();
    return rect === undefined ? null : { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, selector);
}

/** Тот же центр, но клик по маркеру ищется среди всех `.issue-marker` по его `id`. */
async function markerCentre(page: Page, markerId: string): Promise<ScreenPoint | null> {
  return page.evaluate((id) => {
    type Rect = { x: number; y: number; width: number; height: number };
    type KonvaNode = { id(): string; getClientRect: () => Rect };
    type KonvaGlobal = { stages: { find(selector: string): KonvaNode[] }[] };
    const konva = (window as unknown as { Konva?: KonvaGlobal }).Konva;
    const node = konva?.stages[0]?.find('.issue-marker').find((entry) => entry.id() === id);
    const rect = node?.getClientRect();
    return rect === undefined ? null : { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, markerId);
}

/** Клик по точке холста в его собственных пикселях (см. `nodeCentre`/`markerCentre`). */
async function clickOnCanvas(page: Page, point: ScreenPoint): Promise<void> {
  const box = await page.getByTestId('editor-canvas').boundingBox();
  if (box === null) throw new Error('холст не виден');
  await page.mouse.click(box.x + point.x, box.y + point.y);
}

const card = (page: Page): Locator => page.getByLabel('Свойства');

async function numberOf(page: Page, label: string): Promise<number> {
  return Number(await card(page).getByLabel(label).inputValue());
}

/**
 * Число белых непрозрачных пикселей в canvas слоя находок (предпоследний слой:
 * последним всегда стоит слой кольца фокуса, D-177): кайма контура и обводка маркеров.
 */
async function whitePixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const layers = document.querySelectorAll<HTMLCanvasElement>('.editor-canvas canvas');
    const canvas = layers[layers.length - 2];
    const context = canvas?.getContext('2d');
    if (canvas === undefined || context === null || context === undefined) return -1;
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let white = 0;
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i + 3] ?? 0) < 200) continue;
      if ((data[i] ?? 0) > 240 && (data[i + 1] ?? 0) > 240 && (data[i + 2] ?? 0) > 240) white += 1;
    }
    return white;
  });
}

test('находки примера помечены на плане без клика, выбранная — сильнее', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await page.getByTestId('plan-file-input').setInputFiles(EXAMPLE);
  await showTab(page, 'Проверка');
  const validation = page.getByLabel('Проверка плана');
  const items = validation.locator('.issues__item');
  // Восемь геометрических проблем примера — восемь строк: повтор «ни в одной зоне»
  // снят (operator №19); плюс два правила команды, которые приходят к примеру при
  // открытии (D-148): терминал очереди дальше 3 м от входа и нехватка в клиентском зале.
  await expect(items).toHaveCount(10);

  // Каждая сущность, которую находка называет первой, помечена на плане.
  const listed = new Set(
    await items.evaluateAll((nodes) =>
      nodes.map((node) => node.querySelector('button')?.getAttribute('data-ref-id') ?? ''),
    ),
  );
  await expect.poll(async () => (await markers(page)).length).toBe(listed.size);
  const shown = await markers(page);
  expect(new Set(shown.map((marker) => marker.id.replace(/^issue-marker:[a-z]+:/, '')))).toEqual(
    listed,
  );
  // Восемь сущностей: три коллизии помечают кассы и банкомат, стены и зона — оба
  // стеллажа и ПВЗ, правило расстояния — терминал, правило комплектования — зону
  // клиентского зала. Числа на значках в сумме — 10 находок списка.
  expect(shown).toHaveLength(8);
  expect(shown.reduce((sum, marker) => sum + marker.count, 0)).toBe(10);
  expect(shown.every((marker) => !marker.focused)).toBe(true);
  // Геометрия и норма организаторов — ошибки; правило команды у зоны — предупреждение.
  expect(shown.filter((marker) => marker.severity === 'error')).toHaveLength(7);
  expect(shown.find((marker) => marker.id === 'issue-marker:zone:z_client')?.severity).toBe('warning');
  // У стеллажа три находки: коллизия с кассой помечена у кассы, стена и зона — у него.
  expect(shown.find((marker) => marker.id === 'issue-marker:object:eq_rack_1')?.count).toBe(2);

  const whiteBefore = await whitePixels(page);

  // Клик по находке выделяет её маркер крупнее, остальные остаются как были.
  await validation.locator('button[data-ref-id="eq_rack_1"]').first().click();
  await expect
    .poll(async () => (await markers(page)).filter((m) => m.focused).map((m) => m.id))
    .toEqual(['issue-marker:object:eq_rack_1']);
  const after = await markers(page);
  const rack = after.find((marker) => marker.focused);
  const other = after.find((marker) => !marker.focused);
  expect(rack?.radius ?? 0).toBeGreaterThan(other?.radius ?? 0);
  expect(after).toHaveLength(listed.size);

  // Контур выделенного — с белой каймой: читается и на красном стеллаже.
  // Кайма в 1.5 px по обе стороны контура стеллажа — сотни белых пикселей.
  await expect
    .poll(() => whitePixels(page), { timeout: 5_000 })
    .toBeGreaterThan(whiteBefore + 200);

  // Escape гасит выделение, но не маркеры.
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await markers(page)).some((m) => m.focused)).toBe(false);
  expect(await markers(page)).toHaveLength(listed.size);
  await expect.poll(() => whitePixels(page)).toBe(whiteBefore);

  expect(errors).toEqual([]);
});

test('клик по кружочку маркера открывает находку в списке проверки', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await page.getByTestId('plan-file-input').setInputFiles(EXAMPLE);

  // Координаты стеллажа записаны безопасным путём — строкой списка, ещё до
  // клика по маркеру, чтобы ниже проверить, что клик по маркеру не толкнул
  // объект под собой (не начал перетаскивание).
  await showTab(page, 'Проверка');
  const validation = page.getByLabel('Проверка плана');
  await validation.locator('button[data-ref-id="eq_rack_1"]').first().click();
  const baselineX = await numberOf(page, 'X, м');
  const baselineY = await numberOf(page, 'Y, м');
  const markerPoint = await markerCentre(page, 'issue-marker:object:eq_rack_1');
  expect(markerPoint).not.toBeNull();

  // Выбор другого объекта прямо на плане — тем же путём, каким жюри выберет
  // мышью — сворачивает правую колонку до «Свойств» (D-260).
  const otherPoint = await nodeCentre(page, '.equipment-eq_back_wp');
  expect(otherPoint).not.toBeNull();
  await clickOnCanvas(page, otherPoint as { x: number; y: number });
  await expect(card(page).getByTestId('props-id')).toHaveText('eq_back_wp');
  await expect(sideTab(page, 'Проверка')).toHaveAttribute('aria-selected', 'false');

  // Во время рисования клик по тому же месту остаётся клик инструмента:
  // список не открывается и выбор на плане не меняется. Escape здесь не
  // нажимаем — он всегда снимает выделение вместе с черновиком контура
  // (комментарий EditorCanvas), а тут проверяется именно судьба выделения.
  await showTab(page, 'Инвентаризация');
  await page.getByRole('button', { name: 'Помещение', exact: true }).click();
  await clickOnCanvas(page, markerPoint as { x: number; y: number });
  await expect(sideTab(page, 'Инвентаризация')).toHaveAttribute('aria-selected', 'true');
  await expect(sideTab(page, 'Проверка')).toHaveAttribute('aria-selected', 'false');
  await expect(card(page).getByTestId('props-id')).toHaveText('eq_back_wp');
  await page.getByRole('button', { name: 'Выбор', exact: true }).click();

  // Клик по кружочку маркера в «Выбор»: открывает «Проверку» развёрнутой, а
  // не сворачивает до «Свойств» (путь focusOn, не selectOnPlan), сущность
  // выбрана на плане, и клик не провалился в объект под маркером.
  await clickOnCanvas(page, markerPoint as { x: number; y: number });
  await expect(sideTab(page, 'Проверка')).toHaveAttribute('aria-selected', 'true');
  await expect(card(page).getByTestId('props-id')).toHaveText('eq_rack_1');
  expect(await numberOf(page, 'X, м')).toBeCloseTo(baselineX, 3);
  expect(await numberOf(page, 'Y, м')).toBeCloseTo(baselineY, 3);
  await expect
    .poll(async () => (await markers(page)).find((m) => m.focused)?.id)
    .toBe('issue-marker:object:eq_rack_1');

  // Находки стеллажа в списке выделены и первая — в зоне видимости.
  const highlighted = validation.locator('.issues__item.is-focused');
  await expect(highlighted.first()).toBeInViewport();
  const highlightedCount = await highlighted.count();
  expect(highlightedCount).toBeGreaterThan(0);
  const allAboutRack = await highlighted.evaluateAll((nodes) =>
    nodes.every((node) =>
      Array.from(node.querySelectorAll('button')).some(
        (button) => button.getAttribute('data-ref-id') === 'eq_rack_1',
      ),
    ),
  );
  expect(allAboutRack).toBe(true);
  const ariaCurrentCount = await validation.locator('.issues__item[aria-current="true"]').count();
  expect(ariaCurrentCount).toBe(highlightedCount);

  expect(errors).toEqual([]);
});
