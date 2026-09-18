/**
 * M02 в браузере: перечень как рабочий инструмент, а не длинный список.
 *
 * Проверяется то, ради чего панель переделывали: сводка «объекты по типам»
 * видна на экране и сходится со строками перечня, строка сводки и поиск
 * сужают список, а правка плана в 2D меняет сводку в тот же момент — потому
 * что и то и другое считается из одного документа.
 *
 * Отдельный сценарий — объём: тот же синтетический план на 1000 объектов, что
 * и в Q02, и замер времени от ввода в поиск до обновлённого списка.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { PlanDocument } from '../../src/contracts/model';
import { generateBenchmark } from '../../scripts/generate-benchmark';

const BEFORE = join(process.cwd(), 'demo', 'before.json');
const demo = JSON.parse(readFileSync(BEFORE, 'utf8')) as PlanDocument;

/** Сколько объектов каждого типа лежит в файле — ожидания считаются, а не пишутся руками. */
function countByType(plan: PlanDocument): Map<string, number> {
  const counts = new Map<string, number>();
  for (const object of plan.objects) {
    counts.set(object.typeId, (counts.get(object.typeId) ?? 0) + 1);
  }
  return counts;
}

const panel = (page: Page) => page.getByLabel('Инвентаризация');
const inventoryRows = (page: Page) => panel(page).locator('table').first().locator('tbody tr');
const chips = (page: Page) => panel(page).getByTestId('inventory-type');
const chipOf = (page: Page, typeId: string) => panel(page).locator(`[data-type-id="${typeId}"]`);
const search = (page: Page) => panel(page).getByTestId('inventory-search');

async function openDemo(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('plan-file-input').setInputFiles(BEFORE);
  await expect(inventoryRows(page)).toHaveCount(demo.objects.length);
}

test.describe('перечень оборудования', () => {
  test('сводка по типам сходится со строками перечня', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openDemo(page);

    const counts = countByType(demo);
    await expect(chips(page)).toHaveCount(counts.size);

    // Сумма по типам равна числу строк: сводка считает тот же план.
    const shown = await panel(page).getByTestId('inventory-type-count').allTextContents();
    expect(shown.reduce((sum, text) => sum + Number(text), 0)).toBe(demo.objects.length);

    // И каждое число сводки равно числу строк этого типа в перечне.
    for (const [typeId, count] of counts) {
      await expect(chipOf(page, typeId)).toContainText(String(count));
      await chipOf(page, typeId).click();
      await expect(inventoryRows(page)).toHaveCount(count);
      await chipOf(page, typeId).click();
    }
    await expect(inventoryRows(page)).toHaveCount(demo.objects.length);

    expect(errors).toEqual([]);
  });

  test('строка сводки фильтрует перечень и сбрасывается', async ({ page }) => {
    await openDemo(page);
    const workplaces = countByType(demo).get('ot_workplace') ?? 0;
    expect(workplaces).toBeGreaterThan(1);

    await chipOf(page, 'ot_workplace').click();

    await expect(inventoryRows(page)).toHaveCount(workplaces);
    await expect(chipOf(page, 'ot_workplace')).toHaveAttribute('aria-pressed', 'true');
    await expect(panel(page).getByTestId('inventory-shown')).toHaveText(
      `Показано ${workplaces} из ${demo.objects.length}`,
    );
    // В перечне остался только выбранный тип — строка называет его в каждой строке.
    for (const row of await inventoryRows(page).all()) {
      await expect(row).toContainText('ot_workplace');
    }

    await panel(page).getByRole('button', { name: 'Сбросить фильтр' }).click();
    await expect(inventoryRows(page)).toHaveCount(demo.objects.length);
  });

  test('поиск находит объект по инвентарному номеру и по зоне', async ({ page }) => {
    await openDemo(page);

    await search(page).fill('ИНВ-ДЕМО-010');
    await expect(inventoryRows(page)).toHaveCount(1);
    await expect(inventoryRows(page).first()).toContainText('Окно 1 — приём и выдача');

    const waiting = demo.objects.filter((object) => object.zoneId === 'z_waiting').length;
    expect(waiting).toBeGreaterThan(0);
    await search(page).fill('z_waiting');
    await expect(inventoryRows(page)).toHaveCount(waiting);

    await search(page).fill('такого объекта нет');
    await expect(inventoryRows(page)).toHaveCount(0);
    await expect(panel(page).getByText(/Ничего не найдено/)).toBeVisible();

    await search(page).fill('');
    await expect(inventoryRows(page)).toHaveCount(demo.objects.length);
  });

  test('объект, поставленный в 2D, сразу виден в сводке по типам', async ({ page }) => {
    await openDemo(page);
    const benches = countByType(demo).get('ot_bench') ?? 0;
    await expect(chipOf(page, 'ot_bench')).toContainText(String(benches));

    await page
      .locator('.library__item', { hasText: 'Скамья / кресла для ожидания' })
      .first()
      .click();
    await page.getByTestId('editor-canvas').click({ position: { x: 300, y: 300 } });
    await page.getByRole('button', { name: 'Выбор', exact: true }).click();

    await expect(inventoryRows(page)).toHaveCount(demo.objects.length + 1);
    await expect(chipOf(page, 'ot_bench')).toContainText(String(benches + 1));

    // Отмена правки возвращает и перечень, и сводку.
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(inventoryRows(page)).toHaveCount(demo.objects.length);
    await expect(chipOf(page, 'ot_bench')).toContainText(String(benches));
  });

  test('1000 объектов: сводка и поиск работают на объёме Q02', async ({ page }, testInfo) => {
    test.slow();
    const plan = generateBenchmark(1000);
    const counts = countByType(plan);
    const [typeId, count] = [...counts][0] ?? ['', 0];

    await page.goto('/');
    await page.getByTestId('plan-file-input').setInputFiles({
      name: 'benchmark-1000.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(plan)),
    });
    await expect(inventoryRows(page)).toHaveCount(1000, { timeout: 180_000 });
    await expect(chips(page)).toHaveCount(counts.size);

    // Замер: от ввода в поиск до обновлённого списка.
    const started = Date.now();
    await search(page).fill(typeId);
    await expect(inventoryRows(page)).toHaveCount(count);
    const filterMs = Date.now() - started;

    const clearStarted = Date.now();
    await search(page).fill('');
    await expect(inventoryRows(page)).toHaveCount(1000);
    const clearMs = Date.now() - clearStarted;

    console.log(`1000 объектов: фильтр ${filterMs} мс, сброс ${clearMs} мс (${typeId} — ${count} строк)`);
    await testInfo.attach('фильтр на 1000 объектов, мс', {
      body: JSON.stringify({ typeId, count, filterMs, clearMs }, null, 2),
      contentType: 'application/json',
    });
    // Порог мягкий: это защита от обвала, числа для README берутся из вложения.
    expect(filterMs).toBeLessThan(5000);
    expect(clearMs).toBeLessThan(5000);
  });
});
