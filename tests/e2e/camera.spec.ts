/**
 * UI-3 в браузере: камера ставится осмысленно и не растягивается (D-228).
 *
 * Обещания пакета: настенный прибор из библиотеки прижимается к ближайшей
 * стене и разворачивается внутрь помещения — сектор обзора больше не смотрит
 * в стену; у выбранной камеры нет ручек размера, а поворот и перенос руками
 * работают как у любого объекта. Проверяется по карточке свойств и по узлам
 * сцены, не на глаз.
 */

import { expect, test, type Page } from './fixtures';
import { showProps, showTab } from './side-tabs';

type Screen = { x: number; y: number };
type Calibration = { scale: number; origin: Screen };

const CAMERA = 'Камера видеонаблюдения';
const RACK = 'Шкаф / стеллаж для посылок';
/** Зазор ручки поворота от передней кромки, как в EquipmentLayer. */
const ROTATION_GAP_PX = 28;

const card = (page: Page) => page.getByLabel('Свойства');

async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function clickCanvas(page: Page, point: Screen): Promise<void> {
  await settle(page);
  await page.getByTestId('editor-canvas').click({ position: point });
}

/** Масштаб и начало координат холста — из того, что холст публикует о виде. */
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

async function numberOf(page: Page, label: string): Promise<number> {
  return Number(await card(page).getByLabel(label).inputValue());
}

/** Ставит объект библиотеки в точку мира и возвращает инструмент «Выбор». */
async function place(page: Page, label: string, view: Calibration, x: number, y: number): Promise<void> {
  await showTab(page, 'Библиотека');
  await page.locator('.library__item', { hasText: label }).first().click();
  await clickCanvas(page, toScreen(view, x, y));
  await page.getByRole('button', { name: 'Выбор', exact: true }).click();
  // Поставленный объект выбран, но библиотека остаётся на месте (D-268).
  await showProps(page);
}

async function onPage(page: Page, point: Screen): Promise<Screen> {
  const box = await page.getByTestId('editor-canvas').boundingBox();
  if (box === null) throw new Error('холст не виден');
  return { x: box.x + point.x, y: box.y + point.y };
}

async function drag(page: Page, from: Screen, to: Screen): Promise<void> {
  const start = await onPage(page, from);
  const end = await onPage(page, to);
  await settle(page);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 3, start.y + 3);
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}

/** Имена ручек, которые сцена сейчас предлагает тянуть. */
async function handleNames(page: Page): Promise<string[]> {
  await settle(page);
  return page.evaluate(() => {
    type Node = { name(): string };
    type Stage = { find(selector: (node: Node) => boolean): Node[] };
    const konva = (window as unknown as { Konva?: { stages: Stage[] } }).Konva;
    if (konva === undefined) throw new Error('Konva не найден в window');
    return konva.stages
      .flatMap((stage) => stage.find((node) => node.name().startsWith('handle-')))
      .map((node) => node.name())
      .sort();
  });
}

test.describe('камеры: постановка и жесты', () => {
  test('камера прилипает к ближайшей стене и смотрит внутрь помещения', async ({ page }) => {
    await page.goto('/');
    const view = await canvasView(page);

    // Новый план — 12 × 9 м, стены толщиной 0,25 м. Камера 0,15 м глубиной
    // встаёт центром в 0,125 + 0,075 = 0,2 м от оси стены.
    await place(page, CAMERA, view, 6, 0.6);
    expect(await numberOf(page, 'Поворот, °')).toBe(0);
    expect(await numberOf(page, 'Y, м')).toBeCloseTo(0.2, 2);
    expect(await numberOf(page, 'X, м')).toBeCloseTo(6, 2);

    await place(page, CAMERA, view, 0.5, 4);
    expect(await numberOf(page, 'Поворот, °')).toBe(90);
    expect(await numberOf(page, 'X, м')).toBeCloseTo(0.2, 2);

    await place(page, CAMERA, view, 6, 8.5);
    expect(await numberOf(page, 'Поворот, °')).toBe(180);
    expect(await numberOf(page, 'Y, м')).toBeCloseTo(8.8, 2);

    await place(page, CAMERA, view, 11.4, 4);
    expect(await numberOf(page, 'Поворот, °')).toBe(270);
    expect(await numberOf(page, 'X, м')).toBeCloseTo(11.8, 2);

    // Дальше метра от стены камера остаётся под курсором, но смотрит от
    // ближайшей стены: так повторяется демо-план, где приборы стоят посреди зала.
    await place(page, CAMERA, view, 6, 5.5);
    expect(await numberOf(page, 'Поворот, °')).toBe(180);
    expect(await numberOf(page, 'X, м')).toBeCloseTo(6, 2);
    expect(await numberOf(page, 'Y, м')).toBeCloseTo(5.5, 2);

    // Мебель ставится там, где кликнули, и без поворота — правило адресное.
    await place(page, RACK, view, 6, 4);
    expect(await numberOf(page, 'Поворот, °')).toBe(0);
    expect(await numberOf(page, 'Y, м')).toBeCloseTo(4, 2);
  });

  test('у камеры нет ручек размера, но её можно повернуть и перенести', async ({ page }) => {
    await page.goto('/');
    const view = await canvasView(page);

    await place(page, RACK, view, 6, 4);
    await clickCanvas(page, toScreen(view, 6, 4));
    expect(await handleNames(page)).toEqual([
      'handle-resize-e',
      'handle-resize-n',
      'handle-resize-ne',
      'handle-resize-nw',
      'handle-resize-s',
      'handle-resize-se',
      'handle-resize-sw',
      'handle-resize-w',
      'handle-rotate',
    ]);

    await place(page, CAMERA, view, 6, 0.6);
    // Поставленный объект уже выбран (D-147): карточка про камеру.
    await expect(card(page).getByTestId('props-id')).toHaveText('eq_2');
    expect(await handleNames(page)).toEqual(['handle-rotate']);

    // Поворот за ручку: указатель на 45° по часовой от «вперёд».
    const centre = toScreen(view, 6, 0.2);
    const reach = (0.15 / 2) * view.scale + ROTATION_GAP_PX;
    const rad = (45 * Math.PI) / 180;
    await drag(page, { x: centre.x, y: centre.y - reach }, {
      x: centre.x + 160 * Math.sin(rad),
      y: centre.y - 160 * Math.cos(rad),
    });
    const turned = await numberOf(page, 'Поворот, °');
    expect(Math.abs(turned - 45)).toBeLessThanOrEqual(0.5);

    // Перенос мышью: камера уезжает вправо примерно на пройденное расстояние.
    const before = await numberOf(page, 'X, м');
    await drag(page, centre, { x: centre.x + 2 * view.scale, y: centre.y });
    const after = await numberOf(page, 'X, м');
    expect(Math.abs(after - before - 2)).toBeLessThanOrEqual(0.3);
  });
});
