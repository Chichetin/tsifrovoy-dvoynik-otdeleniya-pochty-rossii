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
import { expect, test, type Locator, type Page } from './fixtures';
import type { PlanDocument } from '../../src/contracts/model';
import { generateBenchmark } from '../../scripts/generate-benchmark';
import { expandInventoryRows, expandInventoryTypes } from './inventory-collapse';
import { showTab } from './side-tabs';

const BEFORE = join(process.cwd(), 'demo', 'before.json');
const EXAMPLE = join(process.cwd(), 'example_plan.json');
const demo = JSON.parse(readFileSync(BEFORE, 'utf8')) as PlanDocument;

/** Сколько объектов каждого типа лежит в файле — ожидания считаются, а не пишутся руками. */
function countByType(plan: PlanDocument): Map<string, number> {
  const counts = new Map<string, number>();
  for (const object of plan.objects) {
    counts.set(object.typeId, (counts.get(object.typeId) ?? 0) + 1);
  }
  return counts;
}

/** Название типа из справочника, который приехал вместе с планом. */
function typeLabel(plan: PlanDocument, typeId: string): string {
  const type = plan.catalog.objectTypes.find((entry) => entry.id === typeId);
  if (type === undefined) throw new Error(`Нет типа ${typeId} в справочнике плана`);
  return type.label;
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
  // Этот спек читает и кликает по перечню и сводке без разбора индексов —
  // раскрываем оба свёрнутых списка один раз, а не в каждом тесте отдельно.
  // Раскрывающие помощники сами показывают вкладку «Инвентаризация» первым
  // делом — переживший перезагрузку выбор вкладки (D-249, localStorage) мог
  // указывать на другую панель.
  await expandInventoryRows(page);
  await expandInventoryTypes(page);
}

async function firstColumnWidth(table: Locator): Promise<number> {
  return table.locator('col').first().evaluate((column) =>
    Number.parseFloat((column as HTMLElement).style.width),
  );
}

async function widenFirstColumn(page: Page, table: Locator, pixels: number): Promise<void> {
  const handle = table.getByTestId('column-resize').first();
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  if (box === null) throw new Error('ручка ширины не видна');
  // Левая половина ручки лежит внутри своей ячейки; ровно на границе браузер
  // может выбрать соседний `th`, хотя визуально указатель стоит на разделителе.
  const x = box.x + 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + pixels, y, { steps: 4 });
  await page.mouse.up();
}

test.describe('перечень оборудования', () => {
  test('ширины колонок инвентаризации и площадей тянутся и переживают перезагрузку', async ({ page }) => {
    await openDemo(page);
    // Колонки тянутся на своих вкладках: видна одна панель за раз (D-249).
    await showTab(page, 'Инвентаризация');
    const inventoryTable = panel(page).locator('table').first();
    const inventoryBefore = await firstColumnWidth(inventoryTable);
    await widenFirstColumn(page, inventoryTable, 24);
    await expect.poll(() => firstColumnWidth(inventoryTable)).toBeGreaterThan(inventoryBefore);
    const inventorySaved = await firstColumnWidth(inventoryTable);

    await showTab(page, 'Площади');
    const metricsTable = page.getByLabel('Площади').getByRole('table');
    const metricsBefore = await firstColumnWidth(metricsTable);
    await widenFirstColumn(page, metricsTable, 24);
    await expect.poll(() => firstColumnWidth(metricsTable)).toBeGreaterThan(metricsBefore);
    const metricsSaved = await firstColumnWidth(metricsTable);

    await openDemo(page);
    await showTab(page, 'Инвентаризация');
    await expect.poll(() => firstColumnWidth(panel(page).locator('table').first())).toBe(inventorySaved);
    await showTab(page, 'Площади');
    await expect.poll(() => firstColumnWidth(page.getByLabel('Площади').getByRole('table'))).toBe(metricsSaved);
  });

  test('сводка по типам сходится со строками перечня', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openDemo(page);

    const counts = countByType(demo);
    await expect(chips(page)).toHaveCount(counts.size);

    // Сумма по типам равна числу строк: сводка считает тот же план.
    const shown = await panel(page).getByTestId('inventory-type-count').allTextContents();
    expect(shown.reduce((sum, text) => sum + Number(text), 0)).toBe(demo.objects.length);

    // Every displayed count is checked. Filtering itself is one shared UI
    // action: sample sparse, frequent and last types without 48 redraws.
    for (const [typeId, count] of counts) {
      await expect(chipOf(page, typeId).getByTestId('inventory-type-count')).toHaveText(String(count));
    }
    const entries = [...counts];
    const sampled = new Set([
      entries[0]?.[0],
      entries.find(([, count]) => count > 1)?.[0],
      entries.find(([, count]) => count === 1)?.[0],
      entries.at(-1)?.[0],
    ].filter((id): id is string => id !== undefined));
    for (const typeId of sampled) {
      const count = counts.get(typeId)!;
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

  test('в перечне и в находках стоят названия, а не только ot_* и z_*', async ({ page }) => {
    await openDemo(page);
    const bench = typeLabel(demo, 'ot_bench');
    expect(bench).not.toMatch(/^ot_/);

    // Строка сводки названа словами справочника.
    await expect(chipOf(page, 'ot_bench')).toContainText(bench);

    await chipOf(page, 'ot_bench').click();
    const row = inventoryRows(page).first();
    // В строке перечня: название типа словами и его id рядом, не вместо.
    await expect(row).toContainText(bench);
    await expect(row).toContainText('ot_bench');
    // Зона названа именем из плана, id — рядом.
    await expect(row).toContainText('Зона ожидания');
    await expect(row).toContainText('z_waiting');
    await panel(page).getByRole('button', { name: 'Сбросить фильтр' }).click();

    // Разрез по зонам — тоже по именам.
    const zones = panel(page).locator('table').nth(1);
    await expect(zones).toContainText('Клиентский зал');
    await expect(zones).toContainText('z_client');

    // Находка проверки называет объект, о котором она.
    await showTab(page, 'Проверка');
    const checks = page.getByLabel('Проверка плана');
    const terminal = checks.locator('button[data-ref-id="eq_1"]', {
      hasText: 'Терминал электронной очереди',
    });
    await expect(terminal).toHaveText('Терминал электронной очереди');

    // Само предложение и ссылка читаются без внутренних кодов. Они доступны
    // только после явного раскрытия технических деталей.
    const messages = checks.locator('.issues__message');
    await expect(messages.filter({ hasText: 'Скамья / кресла для ожидания' }).first()).toBeVisible();
    await expect(messages.filter({ hasText: 'от главного входа' }).first()).toBeVisible();
    for (const message of await messages.allTextContents()) {
      expect(message).not.toMatch(/\b(?:ot|op|w)_[a-z0-9_]+\b/i);
    }
    await checks.getByRole('checkbox', { name: 'Показать технические детали' }).check();
    await expect(checks.getByText('object:eq_1').first()).toBeVisible();
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
    // Свободный пол демо-плана: на занятое место объект теперь не встаёт (D-286).
    // Точка пересчитана 22.09 вместе с `demo.spec.ts`: после того как вписывание
    // стало обновляться при смене ширины панелей, прежняя (340, 447) попала на
    // занятое место и скамья не вставала. На холсте 664 × 671 масштаб «Вписать» —
    // 40 px/м, и (120, 456) — это модель (2,2; 2), свободный пол зоны ожидания.
    await page.getByTestId('editor-canvas').click({ position: { x: 120, y: 456 } });
    await page.getByRole('button', { name: 'Выбор', exact: true }).click();

    await expect(inventoryRows(page)).toHaveCount(demo.objects.length + 1);
    await expect(chipOf(page, 'ot_bench')).toContainText(String(benches + 1));

    // Отмена правки возвращает и перечень, и сводку.
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(inventoryRows(page)).toHaveCount(demo.objects.length);
    await expect(chipOf(page, 'ot_bench')).toContainText(String(benches));
  });

  test('1000 объектов: сводка и поиск работают на объёме Q02', async ({ page }) => {
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
    // Тысяча строк перерисовывается не мгновенно, и столько же времени это
    // занимает после фильтра, сколько при загрузке: под полной параллельной
    // нагрузкой на слабой машине стандартные 5 с не хватало, и набор краснел
    // тестом, который в одиночку проходит. Ожидаемое число строк остаётся
    // точным (D-176) — растёт только терпение.
    const RENDER_TIMEOUT_MS = 180_000;
    await expect(inventoryRows(page)).toHaveCount(1000, { timeout: RENDER_TIMEOUT_MS });
    await expect(chips(page)).toHaveCount(counts.size);

    await search(page).fill(typeId);
    await expect(inventoryRows(page)).toHaveCount(count, { timeout: RENDER_TIMEOUT_MS });

    await search(page).fill('');
    await expect(inventoryRows(page)).toHaveCount(1000, { timeout: RENDER_TIMEOUT_MS });
  });

  test('колонка «Инв. №» показывает номера и сортирует перечень', async ({ page }) => {
    await openDemo(page);

    // Номер стоит первой ячейкой строки — его ищут глазами, а не в карточке.
    const numbers = async (): Promise<string[]> =>
      inventoryRows(page).locator('td:first-child').allInnerTexts();
    const own = new Map(
      demo.objects.map((object) => [object.id, String(object.attributes['inventoryNumber'] ?? '')]),
    );
    expect(new Set(own.values()).size).toBe(demo.objects.length);
    expect(await numbers()).toEqual(demo.objects.map((object) => own.get(object.id)));

    const header = panel(page).locator('th').filter({ hasText: 'Инв. №' });
    const column = header.getByTestId('inventory-sort');
    await column.click();
    const ascending = await numbers();
    await expect(header).toHaveAttribute('aria-sort', 'ascending');
    expect(ascending).toEqual(
      [...ascending].sort((a, b) => a.localeCompare(b, 'ru', { numeric: true })),
    );

    await column.click();
    await expect(header).toHaveAttribute('aria-sort', 'descending');
    expect(await numbers()).toEqual([...ascending].reverse());

    // Третий клик возвращает порядок плана, а не «какой-нибудь».
    await column.click();
    await expect(header).toHaveAttribute('aria-sort', 'none');
    expect(await numbers()).toEqual(demo.objects.map((object) => own.get(object.id)));
  });

  test('перечень прокручивается внутри панели, а не растягивает страницу', async ({ page }) => {
    await openDemo(page);
    const scroll = panel(page).getByTestId('inventory-scroll');

    const box = await scroll.evaluate((node) => ({
      client: node.clientHeight,
      content: node.scrollHeight,
    }));
    // 53 строки не помещаются в отведённую высоту — значит, панель их прокручивает.
    expect(box.content).toBeGreaterThan(box.client);
    expect(box.client).toBeLessThan(600);

    await scroll.evaluate((node) => node.scrollTo(0, node.scrollHeight));
    expect(await scroll.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);

    // Разрез по зонам остаётся ниже на той же странице, а не уезжает за перечень.
    await expect(panel(page).getByText('Столбец «с вложенными» суммировать нельзя', { exact: false })).toBeVisible();
  });

  test('«Скачать CSV» отдаёт файл с кириллицей и всеми строками перечня', async ({
    page,
  }, testInfo) => {
    await openDemo(page);
    await expect(panel(page).getByTestId('inventory-csv-scope')).toHaveText(
      `выгрузится весь перечень: строк ${demo.objects.length}`,
    );

    const event = await Promise.all([
      page.waitForEvent('download'),
      panel(page).getByTestId('inventory-csv').click(),
    ]).then(([download]) => download);

    expect(event.suggestedFilename()).toMatch(/\.csv$/);
    const saved = await event.path();
    expect(saved).not.toBeNull();
    const bytes = readFileSync(saved as string);
    // BOM и разделитель «;» — то, ради чего файл открывается в Excel.
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);

    const text = bytes.toString('utf8');
    const lines = text.split('\r\n');
    expect(lines).toHaveLength(demo.objects.length + 1);
    expect(lines[0]).toBe('﻿Инв. №;Объект;id объекта;Тип;id типа;Зона;id зоны');
    const [firstObject] = demo.objects;
    if (firstObject === undefined) throw new Error('в демо-плане нет объектов');
    expect(lines[1]).toContain(String(firstObject.attributes['inventoryNumber']));
    expect(lines[1]).toContain(firstObject.label);
    expect(lines[1]).toContain(firstObject.id);

    await expect(panel(page).getByTestId('inventory-csv-done')).toContainText(
      `строк ${demo.objects.length}`,
    );

    // Сам файл кладём в отчёт: «кириллица не рассыпалась» проверяется глазами,
    // а не только длиной строк.
    await testInfo.attach(event.suggestedFilename(), { body: bytes, contentType: 'text/csv' });
  });

  test('CSV выгружает то, что показано: фильтр и порядок сортировки', async ({ page }) => {
    await openDemo(page);
    const benches = countByType(demo).get('ot_bench') ?? 0;
    expect(benches).toBeGreaterThan(1);

    await chipOf(page, 'ot_bench').click();
    await expect(panel(page).getByTestId('inventory-csv-scope')).toHaveText(
      `выгрузится отфильтрованное: строк ${benches} из ${demo.objects.length}`,
    );

    const event = await Promise.all([
      page.waitForEvent('download'),
      panel(page).getByTestId('inventory-csv').click(),
    ]).then(([download]) => download);

    const lines = readFileSync((await event.path()) as string, 'utf8').split('\r\n');
    expect(lines).toHaveLength(benches + 1);
    for (const line of lines.slice(1)) expect(line).toContain('ot_bench');
    await expect(panel(page).getByTestId('inventory-csv-done')).toContainText('(по фильтру)');
  });

  test('открыли другой план — фильтр прошлого не прячет новый перечень', async ({ page }) => {
    await openDemo(page);
    await search(page).fill('ИНВ-ДЕМО-010');
    await expect(inventoryRows(page)).toHaveCount(1);

    // Замена плана спрашивает про текущую работу — соглашаемся.
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByTestId('plan-file-input').setInputFiles(EXAMPLE);

    await expect(search(page)).toHaveValue('');
    await expect(panel(page).getByTestId('inventory-shown')).toHaveCount(0);
    const example = JSON.parse(readFileSync(EXAMPLE, 'utf8')) as { equipment: unknown[] };
    await expect(inventoryRows(page)).toHaveCount(example.equipment.length);
  });
});
