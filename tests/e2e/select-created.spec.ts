/**
 * Находка operator №9 в браузере: то, что сотрудник только что создал, должно
 * быть выделено.
 *
 * Роль проектировщика: поставил объект из библиотеки или нарисовал зону — и
 * сразу правит её свойства. До этой правки карточка продолжала показывать
 * прежнее, и «что я сейчас создал и с какими атрибутами» узнать было неоткуда.
 *
 * Проверяем через карточку свойств: в ней стоит `id` созданного, причём по
 * нему никто не кликал.
 */

import { expect, test, type Page } from '@playwright/test';

type Pixel = { x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };

const card = (page: Page) => page.getByLabel('Свойства');
const propsId = (page: Page) => card(page).getByTestId('props-id');

async function stageRect(page: Page): Promise<Rect> {
  const box = await page.locator('.editor-canvas canvas').first().boundingBox();
  if (box === null) throw new Error('сцена не смонтирована');
  return box;
}

async function openEditor(page: Page): Promise<Rect> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Цифровой двойник ОПС' })).toBeVisible();
  await expect(page.locator('.editor-canvas canvas').first()).toBeVisible();
  return stageRect(page);
}

/** Две кадровые отрисовки: Konva успевает смонтировать слой под курсором. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function clickAt(page: Page, point: Pixel): Promise<void> {
  const rect = await stageRect(page);
  await settle(page);
  await page.mouse.click(rect.x + point.x, rect.y + point.y);
}

/** Доли сцены, чтобы сценарий не зависел от размера окна. */
function at(rect: Rect, fx: number, fy: number): Pixel {
  return { x: rect.width * fx, y: rect.height * fy };
}

test.describe('созданное выделяется', () => {
  test('объект из библиотеки и нарисованная зона сразу открыты в карточке', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    const rect = await openEditor(page);
    await expect(card(page)).toContainText('Выберите');

    // Объект из библиотеки: один клик по типу, один по холсту — и всё.
    await page.locator('.library__item').first().click();
    await clickAt(page, at(rect, 0.4, 0.4));

    await expect(propsId(page)).toBeVisible();
    const objectId = ((await propsId(page).textContent()) ?? '').trim();
    expect(objectId).toMatch(/^eq_/);

    // Зона поверх него: карточка должна переехать на неё, а не остаться на объекте.
    await page.getByRole('button', { name: 'Зона', exact: true }).click();
    const ring = [
      at(rect, 0.55, 0.55),
      at(rect, 0.85, 0.55),
      at(rect, 0.85, 0.85),
      at(rect, 0.55, 0.85),
    ];
    for (const point of ring) await clickAt(page, point);
    await clickAt(page, ring[0] as Pixel);
    await page.getByRole('button', { name: 'Выбор', exact: true }).click();

    await expect(propsId(page)).not.toHaveText(objectId);
    await expect(propsId(page)).toHaveText(/^z_/);

    expect(errors).toEqual([]);
  });

  test('перетаскивание существующего объекта карточку не подменяет', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    const rect = await openEditor(page);

    await page.locator('.library__item').first().click();
    await clickAt(page, at(rect, 0.35, 0.45));
    await page.getByRole('button', { name: 'Выбор', exact: true }).click();
    const objectId = ((await propsId(page).textContent()) ?? '').trim();

    // Пользователь ушёл смотреть помещение, потом подвинул объект: карточка
    // остаётся там, где он её оставил, — правка не создание.
    await page.getByLabel('Инвентаризация').locator('.table__link').first().click();
    const parked = ((await propsId(page).textContent()) ?? '').trim();

    const from = at(rect, 0.35, 0.45);
    const to = at(rect, 0.45, 0.55);
    await settle(page);
    await page.mouse.move(rect.x + from.x, rect.y + from.y);
    await page.mouse.down();
    await page.mouse.move(rect.x + from.x + 3, rect.y + from.y + 3);
    await page.mouse.move(rect.x + to.x, rect.y + to.y, { steps: 8 });
    await page.mouse.up();

    expect(((await propsId(page).textContent()) ?? '').trim()).toBe(parked);
    expect(parked).toBe(objectId);

    expect(errors).toEqual([]);
  });
});
