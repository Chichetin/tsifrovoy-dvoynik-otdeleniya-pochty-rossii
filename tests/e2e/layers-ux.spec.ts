/**
 * U05-ux в браузере: панель слоёв находится и читается (находка operator №11).
 *
 * На экране 1440×900 с открытым демо-планом панель слоёв видна без прокрутки;
 * два включённых информационных слоя — каждый со своей легендой, а их подписи
 * на холсте не накрывают друг друга. Подписи — узлы сцены Konva с именем
 * `info-label`: их прямоугольники на экране берутся из самой сцены
 * (`window.Konva.stages`), то есть это то, что нарисовано, а не расчёт теста.
 */

import { join } from 'node:path';
import { expect, test, type Locator, type Page } from './fixtures';
import { closeSettings, openSettings, settingsDialog } from './settings';
import { showTab, sideTab } from './side-tabs';

const DEMO = join(process.cwd(), 'demo', 'before.json');

type Rect = { x: number; y: number; width: number; height: number };

const panel = (page: Page) => page.getByLabel('Слои', { exact: true });
const layerItem = (page: Page, name: string) =>
  panel(page)
    .locator('.layers__item')
    .filter({ has: page.locator('.layers__name').getByText(name, { exact: true }) });

/** Screen rectangles of the Konva nodes with this name, in stage pixels. */
async function konvaRects(page: Page, name: string): Promise<Rect[]> {
  return page.evaluate((selector) => {
    type Node = { getClientRect: () => Rect };
    type Stage = { find: (selector: string) => Node[] };
    const konva = (window as unknown as { Konva?: { stages: Stage[] } }).Konva;
    const stage = konva?.stages[0];
    if (stage === undefined) return [];
    return stage.find(selector).map((node) => node.getClientRect());
  }, `.${name}`);
}

const overlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test.use({ viewport: { width: 1440, height: 900 } });

test('демо 1440×900: слои видны без прокрутки, у двух слоёв легенды, подписи не пересекаются', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => void dialog.accept());

  await page.goto('/');

  await showTab(page, 'Слои');
  await page.getByTestId('plan-file-input').setInputFiles(DEMO);
  await expect(layerItem(page, 'Тепловая нагрузка зон')).toBeVisible();

  // Панель слоёв открыта вкладкой левой колонки (D-249; заголовок панели
  // спрятан от глаз — её называет сама вкладка) и целиком помещается в окне
  // вместе с переключателями информационных слоёв; прокрутки нет.
  await expect(sideTab(page, 'Слои')).toBeInViewport({ ratio: 1 });
  await expect(layerItem(page, 'Основной')).toBeInViewport({ ratio: 1 });
  const heat = layerItem(page, 'Тепловая нагрузка зон');
  const staff = layerItem(page, 'Сотрудники по зонам');
  const heatToggle = heat.getByRole('button', { name: 'Показывать слой Тепловая нагрузка зон' });
  const staffToggle = staff.getByRole('button', { name: 'Показывать слой Сотрудники по зонам' });
  await expect(heatToggle).toBeInViewport({ ratio: 1 });
  await expect(staffToggle).toBeInViewport({ ratio: 1 });
  expect(await page.locator('.shell__side').first().evaluate((side) => side.scrollTop)).toBe(0);
  expect(await page.locator('#side-left-panel-layers').evaluate((node) => node.scrollTop)).toBe(0);

  // Подпись видна словами, а не значком; имя слоя не обрезано молча.
  await expect(heatToggle).toContainText('Показывать');
  await expect(heat.locator('.layers__name')).toHaveAttribute(
    'title',
    'Тепловая нагрузка зон',
  );

  await heatToggle.click();
  await staffToggle.click();
  await expect(heatToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(staffToggle).toHaveAttribute('aria-pressed', 'true');

  // Легенда у каждого: шкала и порог из справочника у нагрузки, цвет и единица у сотрудников.
  const heatLegend = heat.getByRole('group', { name: 'Легенда слоя Тепловая нагрузка зон' });
  await expect(heatLegend).toContainText('0 %');
  await expect(heatLegend).toContainText('от 100 % и выше');
  const staffLegend = staff.getByRole('group', { name: 'Легенда слоя Сотрудники по зонам' });
  await expect(staffLegend).toContainText('чел.');

  // На холсте: по подписи на каждую зону каждого слоя (в демо по 8 значений на слой),
  // две строки легенды, и ни одна подпись не накрывает другую или легенду.
  await expect.poll(async () => (await konvaRects(page, 'info-label')).length).toBe(16);
  const labels = await konvaRects(page, 'info-label');
  const [legend] = await konvaRects(page, 'info-legend');
  expect(legend).toBeDefined();
  expect(await konvaRects(page, 'info-caption')).toHaveLength(2);
  for (let i = 0; i < labels.length; i += 1) {
    const a = labels[i] as Rect;
    expect(overlap(a, legend as Rect), `подпись ${i} на легенде`).toBe(false);
    for (let j = i + 1; j < labels.length; j += 1) {
      expect(overlap(a, labels[j] as Rect), `подписи ${i} и ${j}`).toBe(false);
    }
  }

  expect(errors).toEqual([]);
});

/**
 * Alpha of the informational-layer canvas at a model point. One translucent
 * fill (opacity 0.7) gives ≈ 0.7; a nested zone painted over its parent gives
 * 1 − 0.3² ≈ 0.91 — the double paint the operator saw.
 */
async function infoAlphaAt(page: Page, point: [number, number]): Promise<number> {
  const visible = await page.getByTestId('editor-canvas').getAttribute('data-visible');
  const [minX, , maxX, maxY] = (visible ?? '').split(',').map(Number) as [number, number, number, number];
  return page.evaluate(
    ({ point: [x, y], minX, maxX, maxY }) => {
      type Canvas = { _canvas: HTMLCanvasElement; getPixelRatio: () => number };
      type Node = { getLayer: () => { getCanvas: () => Canvas } };
      type Stage = { find: (selector: string) => Node[]; width: () => number };
      const stage = (window as unknown as { Konva: { stages: Stage[] } }).Konva.stages[0] as Stage;
      const scale = stage.width() / (maxX - minX);
      const canvas = (stage.find('.info-fill')[0] as Node).getLayer().getCanvas();
      const ratio = canvas.getPixelRatio();
      const context = canvas._canvas.getContext('2d') as CanvasRenderingContext2D;
      const pixel = context.getImageData(
        Math.round((x - minX) * scale * ratio),
        Math.round((maxY - y) * scale * ratio),
        1,
        1,
      ).data;
      return (pixel[3] ?? 0) / 255;
    },
    { point, minX, maxX, maxY },
  );
}

test('вложенная зона красится один раз: зона очереди внутри клиентского зала', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/');
  await showTab(page, 'Слои');
  await page.getByTestId('plan-file-input').setInputFiles(DEMO);
  await layerItem(page, 'Тепловая нагрузка зон')
    .getByRole('button', { name: 'Показывать слой Тепловая нагрузка зон' })
    .click();
  await expect.poll(async () => (await konvaRects(page, 'info-label')).length).toBe(8);

  // z_queue (5…8.8 × 2.6…4.6) лежит в z_client (0…9 × 0…7); обе со значением.
  // Угол зоны очереди — подальше от её подписи в середине.
  const nested = await infoAlphaAt(page, [5.3, 4.3]);
  // Та же заливка в клиентском зале вне вложенных зон — эталон одного слоя краски.
  const single = await infoAlphaAt(page, [1, 6.5]);
  expect(single).toBeGreaterThan(0.6);
  expect(single).toBeLessThan(0.8);
  expect(Math.abs(nested - single)).toBeLessThan(0.03);
});


test('демо 1440×900: карточки слоёв компактны — библиотека видна без прокрутки, значки не мельче 24 px', async ({
  page,
}) => {
  await page.goto('/');
  await showTab(page, 'Слои');
  await page.getByTestId('plan-file-input').setInputFiles(DEMO);
  await expect(layerItem(page, 'Тепловая нагрузка зон')).toBeVisible();

  // Слои демо со свёрнутыми пояснениями умещаются в панели без прокрутки
  // (D-197), а библиотека — соседняя вкладка той же колонки (D-249): её первая
  // группа видна сразу после переключения, тоже без прокрутки.
  expect(
    await page
      .locator('#side-left-panel-layers')
      .evaluate((node) => node.scrollHeight - node.clientHeight),
  ).toBeLessThanOrEqual(1);
  await showTab(page, 'Библиотека');
  await expect(page.locator('.library__item').first()).toBeInViewport({ ratio: 1 });
  expect(await page.locator('#side-left-panel-library').evaluate((node) => node.scrollTop)).toBe(0);
  await showTab(page, 'Слои');

  // Цель нажатия у значков — не меньше 24×24 (WCAG 2.5.8). Во вкладке у слоя
  // только замок; порядок и удаление — в «Настройках» → «Слои» (D-350).
  const expectIcons = async (scope: Locator, perItem: number): Promise<void> => {
    const icons = scope.locator('.layers__toggle');
    expect(await icons.count()).toBe((await scope.locator('.layers__item').count()) * perItem);
    for (const box of await icons.evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect()).map(({ width, height }) => ({ width, height })),
    )) {
      expect(box.width).toBeGreaterThanOrEqual(24);
      expect(box.height).toBeGreaterThanOrEqual(24);
    }
  };
  await expectIcons(panel(page), 1);
  await openSettings(page, 'Слои');
  const setup = settingsDialog(page).getByRole('region', { name: 'Настройка слоёв' });
  await expectIcons(setup, 3);

  // Селект типа нового слоя не обрезает «Обычный слой».
  const select = setup.getByLabel('Тип нового слоя');
  expect(await select.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await closeSettings(page);
});
