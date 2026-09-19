/**
 * V02 (маркеры): находки проверки видны на плане без клика (operator №10, D-157).
 *
 * Фигуры холста — не DOM, поэтому маркеры читаются через Konva: узел
 * `name="issue-marker"` с `id` вида `issue-marker:<kind>:<id>` и атрибутами
 * `issueCount`, `severity`, `focused`. Сверка идёт со списком «Проверка»: у
 * каждой находки первая ссылка — сущность, которую она помечает на плане.
 */

import { join } from 'node:path';
import { expect, test, type Page } from './fixtures';

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
  const validation = page.getByLabel('Проверка плана');
  const items = validation.locator('.issues__item');
  // Восемь геометрических проблем примера — восемь строк: повтор «ни в одной зоне»
  // снят (operator №19); плюс два правила команды, которые приходят к примеру при
  // открытии (D-148): терминал очереди дальше 3 м от входа и нехватка в клиентском зале.
  await expect(items).toHaveCount(10);

  // Каждая сущность, которую находка называет первой, помечена на плане.
  const listed = new Set(
    await items.evaluateAll((nodes) =>
      nodes.map((node) => node.querySelector('button')?.getAttribute('title') ?? ''),
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
  await validation.getByRole('button', { name: 'eq_rack_1' }).first().click();
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
