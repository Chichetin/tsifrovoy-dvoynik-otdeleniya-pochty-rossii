/**
 * U05 в браузере: слои как группы содержимого и как информационные
 * представления.
 *
 * Главное, что здесь проверяется, — что слой остаётся представлением: скрытый
 * объект никуда не девается из инвентаризации и проверок, а включение
 * информационного слоя ничего не пишет в план.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page , exportPlan, expectUnsavedEdits } from './fixtures';
import { closeSettings, openSettings, settingsDialog } from './settings';
import { showTab, sideTab } from './side-tabs';
import type { PlanDocument } from '../../src/contracts/model';

/**
 * D-350: the «Слои» tab shows, hides and locks a layer; adding, renaming,
 * ordering and deleting a layer live in «Настройки» → «Слои».
 */
const panel = (page: Page) => page.getByLabel('Слои', { exact: true });
const layerItem = (page: Page, name: string) =>
  panel(page)
    .locator('.layers__item')
    .filter({ has: page.locator('.layers__name').getByText(name, { exact: true }) });
const setup = (page: Page) => settingsDialog(page).getByRole('region', { name: 'Настройка слоёв' });
const setupItem = (page: Page, name: string) =>
  setup(page).locator('.layers__item').filter({ has: page.getByLabel(`Имя слоя ${name}`, { exact: true }) });

const card = (page: Page) => page.locator('aside[data-tour="side-right"]').getByRole('region', { name: 'Свойства' });

type Point = { x: number; y: number };

/** How many Konva nodes match the selector on the plan stage. */
async function konvaCount(page: Page, selector: string): Promise<number> {
  return page.evaluate((sel) => {
    type Stage = { find(selector: string): unknown[] };
    const konva = (window as unknown as { Konva?: { stages: Stage[] } }).Konva;
    return konva?.stages[0]?.find(sel).length ?? 0;
  }, selector);
}

/** Objects drawn on the plan: nodes named `equipment-<id>`. */
async function drawnObjects(page: Page): Promise<number> {
  return page.evaluate(() => {
    type Node = { name(): string };
    type Stage = { find(selector: (node: Node) => boolean): Node[] };
    const konva = (window as unknown as { Konva?: { stages: Stage[] } }).Konva;
    const service = new Set(['equipment-selection', 'equipment-hover']);
    return (
      konva?.stages[0]?.find((node) => node.name().startsWith('equipment-') && !service.has(node.name()))
        .length ?? 0
    );
  });
}

/** Centre of a Konva node, in canvas pixels. */
async function nodeCentre(page: Page, selector: string): Promise<Point | null> {
  return page.evaluate((sel) => {
    type Rect = { x: number; y: number; width: number; height: number };
    type Stage = { findOne(selector: string): { getClientRect(): Rect } | undefined };
    const konva = (window as unknown as { Konva?: { stages: Stage[] } }).Konva;
    const rect = konva?.stages[0]?.findOne(sel)?.getClientRect();
    return rect === undefined ? null : { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, selector);
}

async function clickOnCanvas(page: Page, point: Point): Promise<void> {
  const box = await page.getByTestId('editor-canvas').boundingBox();
  if (box === null) throw new Error('холст не виден');
  await page.mouse.click(box.x + point.x, box.y + point.y);
}

async function clickCanvas(page: Page, x: number, y: number): Promise<void> {
  await page.getByTestId('editor-canvas').click({ position: { x, y } });
}

async function drawZone(page: Page): Promise<void> {
  await page.getByRole('toolbar', { name: 'Инструменты плана' }).getByRole('button', { name: 'Зона', exact: true }).click();
  await clickCanvas(page, 200, 180);
  await clickCanvas(page, 430, 180);
  await clickCanvas(page, 430, 360);
  await clickCanvas(page, 200, 360);
  await clickCanvas(page, 200, 180);
  await page.getByRole('button', { name: 'Выбор', exact: true }).click();
}

/**
 * Ставит объект из библиотеки и возвращает левую колонку на прежнюю вкладку:
 * «Слои» и «Библиотека» делят одну колонку (D-249), а спека продолжает
 * работать со списком слоёв сразу после расстановки.
 */
async function placeFromLibrary(page: Page, label: string, x: number, y: number): Promise<void> {
  const before = await sideTab(page, 'Слои').getAttribute('aria-selected');
  await showTab(page, 'Библиотека');
  await page.locator('.library__item', { hasText: label }).first().click();
  await clickCanvas(page, x, y);
  if (before === 'true') await showTab(page, 'Слои');
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

// D-241: сторож на расхождение реального zoneLabelAnchor (D-216,
// `src/features/plan-tools/zone-label.ts`) и его копии в InformationLayer
// (`zoneNameAnchor`, `src/features/layers/zone-name-anchor.ts`) переехал в
// `tests/zone-name-anchor-sync.test.ts` (по ревью MR !182): он не трогает
// браузер, а `vitest.config.ts` уже включает `tests/**/*.test.ts` в обычный
// `npm test`, так что расхождение ловится за секунды, а не за десять минут
// полного `test:e2e`.

test.describe('слои в браузере', () => {
  test('состояние оборудования: цвет, правка и повторное открытие', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await showTab(page, 'Слои');
    await placeFromLibrary(page, 'Рабочее место оператора', 300, 260);
    const status = layerItem(page, 'Состояние оборудования');
    const symbolColor = (): Promise<string | null> => page.evaluate(() => {
      type Node = { name(): string; getChildren(): { getAttr(name: string): string }[] };
      type Stage = { find(selector: (node: Node) => boolean): Node[] };
      const stage = (window as unknown as { Konva?: { stages: Stage[] } }).Konva?.stages[0];
      const group = stage?.find((node) => node.name().startsWith('equipment-eq_'))[0];
      return group?.getChildren()[0]?.getAttr('fill') ?? null;
    });
    await expect.poll(symbolColor).toBe('#4C6EF5');
    await status.getByRole('button', { name: 'Показывать слой Состояние оборудования' }).click();
    await expect.poll(symbolColor).toBe('#868E96');
    const table = status.getByRole('table', { name: 'Состояния объектов, слой Состояние оборудования' });
    const choice = table.getByRole('combobox').first();
    await expect(choice).toHaveValue('unknown');
    await choice.selectOption('repair');
    await expect.poll(symbolColor).toBe('#A15C00');
    await expect(status.getByRole('group', { name: 'Легенда слоя Состояние оборудования' }))
      .toContainText('В ремонте');
    const saved = await savePlan(page);
    const parsed = JSON.parse(saved) as { objects: { attributes: Record<string, unknown> }[] };
    expect(parsed.objects[0]?.attributes.equipmentStatus).toBe('repair');
    await page.getByTestId('plan-file-input').setInputFiles({
      name: 'status.json', mimeType: 'application/json', buffer: Buffer.from(saved),
    });
    await showTab(page, 'Слои');
    await expect.poll(symbolColor).toBe('#A15C00');
    await expect(layerItem(page, 'Состояние оборудования').getByRole('combobox').first()).toHaveValue('repair');
    expect(errors).toEqual([]);
  });

  test('демо-план: статусы видны по цвету и сохраняются после изменения', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await showTab(page, 'Слои');
    await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'demo', 'before.json'));
    await showTab(page, 'Слои');
    const status = layerItem(page, 'Состояние оборудования');
    await status.getByRole('button', { name: 'Показывать слой Состояние оборудования' }).click();
    const colorOf = (id: string): Promise<string | null> => page.evaluate((objectId) => {
      type Node = { getChildren(): { getAttr(name: string): string }[] };
      type Stage = { findOne(selector: string): Node | undefined };
      const stage = (window as unknown as { Konva?: { stages: Stage[] } }).Konva?.stages[0];
      return stage?.findOne(`.equipment-${objectId}`)?.getChildren()[0]?.getAttr('fill') ?? null;
    }, id);
    await expect.poll(() => colorOf('eq_8')).toBe('#C92A2A');
    await expect.poll(() => colorOf('eq_16')).toBe('#A15C00');
    await expect.poll(() => colorOf('eq_13')).toBe('#087F5B');
    await status.getByRole('combobox', { name: /Компьютер оператора 1 \(eq_16\)/ }).selectOption('working');
    await expect.poll(() => colorOf('eq_16')).toBe('#087F5B');
    const repairFilter = status.getByRole('button', { name: 'В ремонте 1' });
    await repairFilter.focus();
    await page.keyboard.press('Enter');
    await expect(repairFilter).toHaveAttribute('aria-pressed', 'true');
    await expect(status.getByRole('table', { name: 'Состояния объектов, слой Состояние оборудования' }).locator('tbody tr')).toHaveCount(1);
    if (process.env.UPDATE_SNAPSHOTS === '1') {
      await status.scrollIntoViewIfNeeded();
      await page.screenshot({ path: test.info().outputPath('equipment-status-1280.png') });
      await page.setViewportSize({ width: 1440, height: 900 });
      await status.scrollIntoViewIfNeeded();
      await page.screenshot({ path: test.info().outputPath('equipment-status-1440.png') });
    }
    const saved = await savePlan(page);
    const objects = (JSON.parse(saved) as { objects: { id: string; attributes: Record<string, unknown> }[] }).objects;
    expect(objects.find((object) => object.id === 'eq_16')?.attributes.equipmentStatus).toBe('working');
    await page.getByTestId('plan-file-input').setInputFiles({
      name: 'demo-status.json', mimeType: 'application/json', buffer: Buffer.from(saved),
    });
    await showTab(page, 'Слои');
    await expect.poll(() => colorOf('eq_16')).toBe('#087F5B');
    expect(errors).toEqual([]);
  });

  test('второй цветовой слой появляется из данных файла без специального UI-кода', async ({ page }) => {
    const plan = JSON.parse(readFileSync(join(process.cwd(), 'demo', 'before.json'), 'utf8')) as PlanDocument;
    for (const type of plan.catalog.objectTypes) {
      type.attributes.push({ key: 'servicePriority', label: 'Приоритет обслуживания', type: 'string', required: false, default: 'ordinary' });
    }
    plan.catalog.layerTypes.push({
      id: 'lt_service_priority', label: 'Приоритет обслуживания', note: 'Сотрудник назначает вручную.',
      representation: {
        kind: 'object-color', attribute: 'servicePriority', defaultValue: 'ordinary',
        values: [
          { value: 'ordinary', label: 'Обычный', color: '#1971C2' },
          { value: 'urgent', label: 'Срочно', color: '#C92A2A' },
        ],
      },
    });
    plan.layers.push({ id: 'l_priority', name: 'Приоритет обслуживания', visible: true, locked: false, order: 99, typeId: 'lt_service_priority' });
    plan.objects[0]!.attributes.servicePriority = 'urgent';
    await page.goto('/');
    await page.getByTestId('plan-file-input').setInputFiles({
      name: 'priority.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(plan)),
    });
    await showTab(page, 'Слои');
    const priority = layerItem(page, 'Приоритет обслуживания');
    await expect(priority.getByRole('button', { name: 'Срочно 1' })).toBeVisible();
    await expect(priority.getByRole('combobox', { name: /Терминал электронной очереди \(eq_1\)/ })).toHaveValue('urgent');
    await expect.poll(() => page.evaluate(() => {
      type Node = { getChildren(): { getAttr(name: string): string }[] };
      type Stage = { findOne(selector: string): Node | undefined };
      return (window as unknown as { Konva?: { stages: Stage[] } }).Konva?.stages[0]
        ?.findOne('.equipment-eq_1')?.getChildren()[0]?.getAttr('fill') ?? null;
    })).toBe('#C92A2A');
  });

  test('создать, переименовать, скрыть, запереть и удалить с переносом', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/');

    await showTab(page, 'Слои');
    await drawZone(page);
    // Нарисованная зона выбрана, её «Свойства» встали вместо слоёв (D-268).
    await showTab(page, 'Слои');
    await placeFromLibrary(page, 'Рабочее место оператора', 300, 260);

    // В панели две таблицы: перечень объектов и разрез по зонам. Нужна первая.
    const inventoryRows = page
      .getByLabel('Инвентаризация')
      .locator('table')
      .first()
      .locator('tbody tr');
    await expect(inventoryRows).toHaveCount(1);
    await expect(layerItem(page, 'Основной').locator('.layers__meta')).toContainText(
      'зон 1, объектов 1',
    );

    // Замок: правка содержимого запертого слоя отклоняется с объяснением.
    await layerItem(page, 'Основной')
      .getByRole('button', { name: 'Запереть слой Основной' })
      .click();
    await placeFromLibrary(page, 'Стеллаж для посылок', 340, 300);
    await expect(page.getByRole('alert')).toContainText('заперт');
    await expect(inventoryRows).toHaveCount(1);
    await layerItem(page, 'Основной')
      .getByRole('button', { name: 'Запереть слой Основной' })
      .click();

    // Новый обычный слой — в «Настройках».
    await openSettings(page, 'Слои');
    await setup(page).getByRole('button', { name: 'Добавить слой' }).click();
    const created = setup(page).locator('.layers__item').filter({ hasText: 'обычный слой' });
    await expect(created).toHaveCount(2);

    // Имя слоя правится там же, на месте.
    await setup(page).getByLabel('Имя слоя Слой 7').fill('Перепланировка');
    await expect(setup(page).getByLabel('Имя слоя Перепланировка')).toBeVisible();
    await closeSettings(page);

    // Скрытие: объект пропадает с холста, но не из инвентаризации и проверок.
    await layerItem(page, 'Основной')
      .getByRole('button', { name: 'Показывать слой Основной' })
      .click();
    await expect(
      layerItem(page, 'Основной').getByRole('button', { name: 'Показывать слой Основной' }),
    ).toHaveAttribute('aria-pressed', 'false');
    await expect(inventoryRows).toHaveCount(1);
    await layerItem(page, 'Основной')
      .getByRole('button', { name: 'Показывать слой Основной' })
      .click();

    // Удаление слоя переносит содержимое в другой слой, а не стирает его.
    await openSettings(page, 'Слои');
    await setupItem(page, 'Основной')
      .getByRole('button', { name: 'Удалить слой Основной' })
      .click();
    await expect(setup(page).getByLabel('Имя слоя Основной')).toHaveCount(0);
    await closeSettings(page);
    await expect(layerItem(page, 'Основной')).toHaveCount(0);
    await expect(inventoryRows).toHaveCount(1);
    await expect(layerItem(page, 'Перепланировка').locator('.layers__meta')).toContainText(
      'зон 1, объектов 1',
    );

    // Порядок слоёв меняется стрелками в «Настройках» и уезжает в файл вместе с планом.
    await openSettings(page, 'Слои');
    const names = (): Promise<string[]> =>
      setup(page)
        .locator('.layers__name')
        .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
    expect(await names()).toEqual([
      'Камеры и зоны обзора',
      'Тепловая нагрузка зон',
      'Сотрудники по зонам',
      'Очередь по зонам',
      'Состояние оборудования',
      'Перепланировка',
    ]);
    await setupItem(page, 'Перепланировка')
      .getByRole('button', { name: 'Поднять слой Перепланировка' })
      .click();
    expect(await names()).toEqual([
      'Камеры и зоны обзора',
      'Тепловая нагрузка зон',
      'Сотрудники по зонам',
      'Очередь по зонам',
      'Перепланировка',
      'Состояние оборудования',
    ]);

    // Все правки слоёв переживают сохранение и повторное открытие.
    await closeSettings(page);
    const saved = await savePlan(page);
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Файл' }).click();
    await page.getByRole('menuitem', { name: 'Создать новый' }).click();
    await expect(layerItem(page, 'Перепланировка')).toHaveCount(0);

    await page.getByTestId('plan-file-input').setInputFiles({
      name: 'layers.json',
      mimeType: 'application/json',
      buffer: Buffer.from(saved),
    });
    await expect(layerItem(page, 'Перепланировка')).toHaveCount(1);
    await openSettings(page, 'Слои');
    expect(await names()).toEqual([
      'Камеры и зоны обзора',
      'Тепловая нагрузка зон',
      'Сотрудники по зонам',
      'Очередь по зонам',
      'Перепланировка',
      'Состояние оборудования',
    ]);
    await closeSettings(page);
    await expect(inventoryRows).toHaveCount(1);

    expect(errors).toEqual([]);
  });

  test('последний слой удалить нельзя', async ({ page }) => {
    await page.goto('/');
    await openSettings(page, 'Слои');

    // Информационные слои — тоже слои: удаляем все, кроме одного.
    for (const name of ['Камеры и зоны обзора', 'Тепловая нагрузка зон', 'Сотрудники по зонам', 'Очередь по зонам', 'Состояние оборудования']) {
      await setupItem(page, name).getByRole('button', { name: `Удалить слой ${name}` }).click();
    }

    const remaining = setup(page).locator('.layers__item');
    await expect(remaining).toHaveCount(1);
    await expect(
      setupItem(page, 'Основной').getByRole('button', { name: 'Удалить слой Основной' }),
    ).toBeDisabled();

    // Удалённый слой камер добавляется снова: его прежний id ушёл в отставку,
    // новый получает следующий номер, а не отказ.
    await setup(page).getByLabel('Тип нового слоя').selectOption({ label: 'Камеры и зоны обзора' });
    await setup(page).getByRole('button', { name: 'Добавить слой' }).click();
    await expect(setupItem(page, 'Камеры и зоны обзора')).toHaveCount(1);
    await expect(page.locator('.shell__error')).toHaveCount(0);
    await closeSettings(page);
    await showTab(page, 'Слои');
    await expect(layerItem(page, 'Камеры и зоны обзора')).toHaveCount(1);
  });

  test('информационные слои: источник чисел объяснён, план не меняется', async ({ page }) => {
    await page.goto('/');
    await showTab(page, 'Слои');
    await drawZone(page);
    // Нарисованная зона выбрана, её «Свойства» встали вместо слоёв (D-268).
    await showTab(page, 'Слои');

    const heat = layerItem(page, 'Тепловая нагрузка зон');
    // Пояснение справочника (не UI-подпись) объясняет источник чисел рядом со слоем.
    await expect(heat.locator('.layers__note')).toContainText('проставляется руками');

    const before = JSON.parse(await savePlan(page));

    // Включение слоя — это показ: в плане меняется только флаг самого слоя,
    // а зоны, объекты и геометрия остаются теми же.
    await heat.getByRole('button', { name: 'Показывать слой Тепловая нагрузка зон' }).click();
    // Показ слоя — не правка: план остаётся сохранённым (D-207, находка operator №11).
    await expectUnsavedEdits(page, false);
    // Пометки условности нет — запрет участника (D-281).
    await expect(heat.getByText('Числа условные')).toHaveCount(0);
    const shown = JSON.parse(await savePlan(page));
    expect(shown.zones).toEqual(before.zones);
    expect(shown.objects).toEqual(before.objects);
    expect(shown.room).toEqual(before.room);

    // Слой действительно рисует: холст после заливки зоны выглядит иначе.
    const canvas = page.getByTestId('editor-canvas');
    const clean = await canvas.screenshot();
    await heat.getByLabel('Тепловая нагрузка зон, Зона 1 (z_1)').fill('80');
    await expectUnsavedEdits(page, true);
    await expect(async () => {
      expect(await canvas.screenshot()).not.toEqual(clean);
    }).toPass();

    // Поле, которое рисует слой, в карточке зоны без подсказки условности (D-281):
    // имя зоны в таблице слоя — ссылка на саму зону, карточка открывается по ней.
    // The table row header, not the zone-load list above it: both name the zone.
    await heat.getByRole('rowheader').getByRole('button', { name: 'Зона 1' }).click();
    await expect(card(page).getByLabel('Загрузка зоны, %')).toBeVisible();
    await expect(card(page).getByText('не измерение')).toHaveCount(0);
    await showTab(page, 'Слои');

    const withValue = JSON.parse(await savePlan(page));
    expect(before.zones[0].attributes.loadPercent ?? null).toBeNull();
    expect(withValue.zones[0].attributes.loadPercent).toBe(80);
    // Слой и его тип уезжают в файл вместе с планом.
    const layer = withValue.layers.find(
      (entry: { typeId: string | null }) => entry.typeId === 'lt_heat',
    );
    expect(layer.visible).toBe(true);
    expect(withValue.catalog.layerTypes.map((type: { id: string }) => type.id)).toContain('lt_heat');
  });

  test('слой камер: сектор обзора рисуется по атрибутам объекта', async ({ page }) => {
    await page.goto('/');
    await showTab(page, 'Слои');
    await placeFromLibrary(page, 'Камера видеонаблюдения', 300, 220);

    const canvas = page.getByTestId('editor-canvas');
    const withoutSector = await canvas.screenshot();

    const cameras = layerItem(page, 'Камеры и зоны обзора');
    await cameras.getByRole('button', { name: 'Показывать слой Камеры и зоны обзора' }).click();

    // Сектор обзора появился на холсте, а не только в панели.
    await expect(async () => {
      expect(await canvas.screenshot()).not.toEqual(withoutSector);
    }).toPass();

    // Значения слоя берутся с объекта, а не из кода панели.
    const angle = cameras.getByLabel('Угол обзора, Камера видеонаблюдения (eq_1)');
    await expect(angle).toHaveValue('90');

    // Шире угол — другой сектор на холсте. Подпись слоя при этом не меняется,
    // поэтому отличие может дать только сам сектор.
    const narrow = await canvas.screenshot();
    await angle.fill('120');
    await expect(angle).toHaveValue('120');
    await expect(async () => {
      expect(await canvas.screenshot()).not.toEqual(narrow);
    }).toPass();

    const saved = JSON.parse(await savePlan(page));
    expect(saved.objects[0].attributes.viewAngleDeg).toBe(120);
  });

  test('сотрудники по зонам: счётчик и его единица из справочника', async ({ page }) => {
    await page.goto('/');
    await showTab(page, 'Слои');
    await drawZone(page);
    // Нарисованная зона выбрана, её «Свойства» встали вместо слоёв (D-268).
    await showTab(page, 'Слои');

    const staff = layerItem(page, 'Сотрудники по зонам');
    await staff.getByRole('button', { name: 'Показывать слой Сотрудники по зонам' }).click();
    await expect(staff.locator('.layers__unit').first()).toHaveText('чел.');

    await staff.getByLabel('Сотрудники по зонам, Зона 1 (z_1)').fill('3');
    const saved = JSON.parse(await savePlan(page));
    expect(saved.zones[0].attributes.staffCount).toBe(3);
  });

  test('D-275: потолочные объекты скрываются отдельно от напольных, план не меняется', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) => void dialog.accept());
    await page.goto('/');
    await showTab(page, 'Слои');
    await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'demo', 'before.json'));

    const base = layerItem(page, 'Основной');
    const ceiling = base.getByRole('button', { name: 'Показывать: потолочные объекты' });
    const floor = base.getByRole('button', { name: 'Показывать: напольные объекты' });
    await expect(ceiling).toContainText('Потолочные объекты (11)');
    await expect(floor).toContainText('Напольные объекты (42)');
    await expect(ceiling).toHaveAttribute('aria-pressed', 'true');

    const opened = await savePlan(page);
    // #233: the mini-map covers the lower left corner of the plan, where eq_26 stands.
    await page.getByRole('button', { name: 'Скрыть мини-карту' }).click();
    const camera = '.equipment-eq_26';
    const bench = '.equipment-eq_6';
    await expect.poll(() => konvaCount(page, camera)).toBe(1);
    const cameraAt = await nodeCentre(page, camera);
    expect(cameraAt).not.toBeNull();

    // Visible camera is picked by a click on the canvas.
    await clickOnCanvas(page, cameraAt!);
    await expect(card(page).getByLabel('Название')).toHaveValue('Камера зоны ожидания');
    expect(await konvaCount(page, '.outline-eq_26')).toBe(1);
    await showTab(page, 'Слои');

    // Hide the ceiling group: the camera leaves the canvas and the selection,
    // the bench stays; the same click no longer picks the camera.
    await ceiling.click();
    await expect(ceiling).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => konvaCount(page, camera)).toBe(0);
    expect(await konvaCount(page, bench)).toBe(1);
    await expect(page.getByLabel('Название', { exact: true })).toHaveCount(0);
    await clickOnCanvas(page, cameraAt!);
    await page.waitForTimeout(300);
    expect(await konvaCount(page, '.outline-eq_26')).toBe(0);
    await expect(card(page).getByLabel('Название')).not.toHaveValue('Камера зоны ожидания');
    await showTab(page, 'Слои');

    // Hiding a group is not an edit: the plan stays saved, the file is the same.
    await expectUnsavedEdits(page, false);
    const whileHidden = await savePlan(page);
    expect(whileHidden).toBe(opened);

    await ceiling.click();
    await expect(ceiling).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => konvaCount(page, camera)).toBe(1);

    // Hidden parent layer: both groups are hidden with it and not clickable.
    await base.getByRole('button', { name: 'Показывать слой Основной' }).click();
    await expect(ceiling).toBeDisabled();
    await expect(floor).toBeDisabled();
    await base.getByRole('button', { name: 'Показывать слой Основной' }).click();

    // An edit made while a group is hidden: the file carries neither the
    // view-only layer nor a borrowed layerId.
    await ceiling.click();
    await expect(ceiling).toHaveAttribute('aria-pressed', 'false');
    const benchAt = await nodeCentre(page, bench);
    expect(benchAt).not.toBeNull();
    await clickOnCanvas(page, benchAt!);
    await expect(card(page).getByLabel('Название')).toHaveValue('Скамья ожидания 1');
    await page.keyboard.press('ArrowRight');
    await expectUnsavedEdits(page, true);
    type Saved = { layers: { id: string }[]; objects: { id: string; layerId: string; position: number[] }[] };
    const edited = JSON.parse(await savePlan(page)) as Saved;
    const original = JSON.parse(opened) as Saved;
    expect(edited.layers.map((layer) => layer.id)).toEqual(original.layers.map((layer) => layer.id));
    expect(JSON.stringify(edited)).not.toContain('__hidden_mount');
    expect(edited.objects.every((object) => object.layerId === 'l_base')).toBe(true);
    const benchPosition = (plan: Saved) => plan.objects.find((object) => object.id === 'eq_6')?.position;
    expect(benchPosition(edited)).not.toEqual(benchPosition(original));

    // Placing a ceiling object while its group is hidden shows the group: the
    // new camera is visible, and a second click cannot place an unseen twin.
    await showTab(page, 'Слои');
    await expect(ceiling).toHaveAttribute('aria-pressed', 'false');
    expect(await drawnObjects(page)).toBe(42);
    await placeFromLibrary(page, 'Камера видеонаблюдения', 300, 220);
    await expect(ceiling).toHaveAttribute('aria-pressed', 'true');
    await expect(ceiling).toContainText('Потолочные объекты (12)');
    // Every object is drawn again: 53 of the demo plus the new camera.
    await expect.poll(() => drawnObjects(page)).toBe(54);

    // Reopening the file saved while hidden shows everything again.
    await ceiling.click();
    await page.getByTestId('plan-file-input').setInputFiles({
      name: 'hidden-ceiling.json',
      mimeType: 'application/json',
      buffer: Buffer.from(whileHidden),
    });
    await expect(ceiling).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => konvaCount(page, camera)).toBe(1);
    expect(errors).toEqual([]);
  });
});

test.describe('покрытие клиентских зон камерами (#32, D-307)', () => {
  test('демо-план: штриховка слепых пятен и доля по зонам; правка камеры меняет долю, файл её не хранит', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) => void dialog.accept());
    await page.goto('/');
    await showTab(page, 'Слои');
    await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'demo', 'before.json'));

    const cameras = layerItem(page, 'Камеры и зоны обзора');
    const table = cameras.getByRole('table', { name: 'Покрытие клиентских зон камерами' });
    // Layer off: nothing counted on screen, nothing hatched.
    await expect(table).toHaveCount(0);
    await expect.poll(() => konvaCount(page, '.camera-blind')).toBe(0);

    await cameras.getByRole('button', { name: 'Показывать слой Камеры и зоны обзора' }).click();
    await expect(table).toBeVisible();
    // Demo cameras face inward (#118): the hall is almost covered, one blind spot stays.
    await expect(table.getByRole('row', { name: /Все клиентские зоны/ })).toContainText('93,8 %');
    await expect(table.getByRole('row', { name: /Зона очереди/ })).toContainText('100 %');
    await expect(table.getByRole('row', { name: /Зона ожидания/ })).toContainText('95,9 %');
    await expect.poll(() => konvaCount(page, '.camera-blind')).toBe(1);
    // No «conditional numbers» caution next to the numbers, in any wording (D-281);
    // the catalog's own note in the collapsed «Что показывает слой» is not a caution.
    const coverage = cameras.getByRole('group', { name: 'Покрытие клиентских зон, слой Камеры и зоны обзора' });
    await expect(coverage.getByText(/условн|не измерение/i)).toHaveCount(0);
    // Showing a layer is not an edit.
    await expectUnsavedEdits(page, false);

    // Keyboard: the zone name in the coverage table is a button that selects the zone.
    const queueButton = table.getByRole('button', { name: 'Зона очереди' });
    await queueButton.focus();
    await page.keyboard.press('Enter');
    await expect(card(page)).toHaveAttribute('data-entity-id', 'z_queue');
    await showTab(page, 'Слои');

    // A wider, longer camera over the waiting zone: the share grows at once.
    await cameras.getByLabel('Угол обзора, Камера зоны ожидания (eq_26)').fill('180');
    await cameras.getByLabel('Дальность обзора, Камера зоны ожидания (eq_26)').fill('9');
    await expect(table.getByRole('row', { name: /Все клиентские зоны/ })).not.toContainText('93,8 %');
    const grown = await table.getByRole('row', { name: /Все клиентские зоны/ }).textContent();
    await expectUnsavedEdits(page, true);

    // Save → reopen: the file keeps the camera's attributes, the coverage is
    // recounted from them and comes out the same; no coverage field in the file.
    const saved = await savePlan(page);
    expect(saved).not.toContain('coverage');
    const camera = (JSON.parse(saved) as { objects: { id: string; attributes: Record<string, unknown> }[] }).objects.find(
      (object) => object.id === 'eq_26',
    );
    expect(camera?.attributes).toMatchObject({ viewAngleDeg: 180, viewRangeM: 9 });
    await page.getByTestId('plan-file-input').setInputFiles({
      name: 'coverage.json',
      mimeType: 'application/json',
      buffer: Buffer.from(saved),
    });
    await showTab(page, 'Слои');
    await expect(table.getByRole('row', { name: /Все клиентские зоны/ })).toHaveText(grown ?? '');
    expect(errors).toEqual([]);
  });
});
