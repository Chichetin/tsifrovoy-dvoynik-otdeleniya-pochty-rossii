/**
 * V02 (подсветка): находка проверки видна на плане, а не только в списке.
 *
 * Каждый слой сцены Konva — отдельный `<canvas>`, и слой находок — последний.
 * С D-157 на нём всегда стоят маркеры находок, поэтому «пусто до клика»
 * проверяется по узлам Konva (`window.Konva`): фигур подсветки `issue-focus-shape`
 * нет до клика, есть после, нет после Escape. Пиксели подтверждают, что
 * подсветка действительно нарисована: красного после клика заметно больше.
 */

import { join } from 'node:path';
import { expect, test, type Page } from './fixtures';
import { showTab } from './side-tabs';

const EXAMPLE = join(process.cwd(), 'example_plan.json');

/** Доля непрозрачных пикселей с преобладанием красного в последнем canvas сцены. */
/** Сколько фигур подсветки выделенной сущности сейчас на сцене. */
async function focusShapes(page: Page): Promise<number> {
  return page.evaluate(() => {
    type KonvaGlobal = { stages: { find(selector: string): unknown[] }[] };
    const konva = (window as unknown as { Konva?: KonvaGlobal }).Konva;
    return konva?.stages[0]?.find('.issue-focus-shape').length ?? -1;
  });
}

async function redShare(page: Page): Promise<number> {
  return page.evaluate(() => {
    const layers = document.querySelectorAll<HTMLCanvasElement>('.editor-canvas canvas');
    const canvas = layers[layers.length - 1];
    if (canvas === undefined) return -1;
    const context = canvas.getContext('2d');
    if (context === null) return -1;
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let red = 0;
    let painted = 0;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3] ?? 0;
      if (alpha === 0) continue;
      painted += 1;
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      if (r > 150 && r > g + 60 && r > b + 60) red += 1;
    }
    return painted === 0 ? 0 : red / painted;
  });
}

test('находка из списка подсвечивается на плане и гаснет по Escape', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await expect(page.locator('.editor-canvas canvas').first()).toBeVisible();

  // Пример организаторов: у стеллажа eq_rack_1 три находки сразу.
  await page.getByTestId('plan-file-input').setInputFiles(EXAMPLE);
  await showTab(page, 'Проверка');
  const validation = page.getByLabel('Проверка плана');
  const rackLink = validation.locator('button[data-ref-id="eq_rack_1"]').first();
  await expect(rackLink).toBeVisible();

  // Сотруднику сначала показаны объяснения и названия, внутренние коды скрыты.
  await expect(validation.getByText('OBJECT_COLLISION')).toHaveCount(0);
  await expect(validation.locator('button[data-ref-id="w_inner_1"]').first()).toHaveText('Стена');
  await expect(validation.getByText('w_inner_1', { exact: true })).toHaveCount(0);
  await expect(validation.locator('button[data-ref-id="d_main"]').first()).toHaveText('Главный вход');
  await expect(validation.getByText('d_main', { exact: true })).toHaveCount(0);
  await validation.getByRole('checkbox', { name: 'Показать технические детали' }).check();
  await expect(validation.getByText('OBJECT_COLLISION').first()).toBeVisible();
  await expect(validation.getByText('object:eq_rack_1').first()).toBeVisible();
  await expect(validation.getByText('wall:w_inner_1').first()).toBeVisible();
  await expect(validation.getByText('opening:d_main').first()).toBeVisible();

  // До клика подсветки нет — только маркеры находок.
  await expect.poll(() => focusShapes(page)).toBe(0);
  const markersOnly = await redShare(page);

  // Клик по ссылке на стеллаж в первой же находке.
  await rackLink.click();
  await expect.poll(() => focusShapes(page), { timeout: 5_000 }).toBeGreaterThan(0);
  await expect
    .poll(() => redShare(page), { timeout: 5_000 })
    .toBeGreaterThan(markersOnly + 0.1);

  // Escape снимает выделение — подсветка гаснет вместе с ним, маркеры остаются.
  await page.keyboard.press('Escape');
  await expect.poll(() => focusShapes(page), { timeout: 5_000 }).toBe(0);
  await expect.poll(() => redShare(page), { timeout: 5_000 }).toBeCloseTo(markersOnly, 2);

  expect(errors).toEqual([]);
});
