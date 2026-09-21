/**
 * U05 в браузере: слои как группы содержимого и как информационные
 * представления.
 *
 * Главное, что здесь проверяется, — что слой остаётся представлением: скрытый
 * объект никуда не девается из инвентаризации и проверок, а включение
 * информационного слоя ничего не пишет в план.
 */

import { readFileSync } from 'node:fs';
import { expect, test, type Page } from './fixtures';
import { showTab, sideTab } from './side-tabs';

const panel = (page: Page) => page.getByLabel('Слои');
const layerItem = (page: Page, name: string) =>
  panel(page).locator('.layers__item').filter({ has: page.getByLabel(`Имя слоя ${name}`) });

async function clickCanvas(page: Page, x: number, y: number): Promise<void> {
  await page.getByTestId('editor-canvas').click({ position: { x, y } });
}

async function drawZone(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Зона', exact: true }).click();
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
    page.getByRole('button', { name: 'Сохранить' }).click(),
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
  test('создать, переименовать, скрыть, запереть и удалить с переносом', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/');

    await showTab(page, 'Слои');
    await drawZone(page);
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

    // Новый обычный слой.
    await panel(page).getByRole('button', { name: 'Добавить слой' }).click();
    const created = panel(page).locator('.layers__item').filter({ hasText: 'обычный слой' });
    await expect(created).toHaveCount(2);

    // Имя слоя правится на месте.
    await panel(page).getByLabel('Имя слоя Слой 6').fill('Перепланировка');
    await expect(panel(page).getByLabel('Имя слоя Перепланировка')).toBeVisible();

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
    await layerItem(page, 'Основной')
      .getByRole('button', { name: 'Удалить слой Основной' })
      .click();
    await expect(panel(page).getByLabel('Имя слоя Основной')).toHaveCount(0);
    await expect(inventoryRows).toHaveCount(1);
    await expect(layerItem(page, 'Перепланировка').locator('.layers__meta')).toContainText(
      'зон 1, объектов 1',
    );

    // Порядок слоёв меняется стрелками и уезжает в файл вместе с планом.
    const names = (): Promise<string[]> =>
      panel(page)
        .locator('.layers__name')
        .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
    expect(await names()).toEqual([
      'Камеры и зоны обзора',
      'Тепловая нагрузка зон',
      'Сотрудники по зонам',
      'Очередь по зонам',
      'Перепланировка',
    ]);
    await layerItem(page, 'Перепланировка')
      .getByRole('button', { name: 'Поднять слой Перепланировка' })
      .click();
    expect(await names()).toEqual([
      'Камеры и зоны обзора',
      'Тепловая нагрузка зон',
      'Сотрудники по зонам',
      'Перепланировка',
      'Очередь по зонам',
    ]);

    // Все правки слоёв переживают сохранение и повторное открытие.
    const saved = await savePlan(page);
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Новый' }).click();
    await expect(panel(page).getByLabel('Имя слоя Перепланировка')).toHaveCount(0);

    await page.getByTestId('plan-file-input').setInputFiles({
      name: 'layers.json',
      mimeType: 'application/json',
      buffer: Buffer.from(saved),
    });
    expect(await names()).toEqual([
      'Камеры и зоны обзора',
      'Тепловая нагрузка зон',
      'Сотрудники по зонам',
      'Перепланировка',
      'Очередь по зонам',
    ]);
    await expect(inventoryRows).toHaveCount(1);

    expect(errors).toEqual([]);
  });

  test('последний слой удалить нельзя', async ({ page }) => {
    await page.goto('/');
    await showTab(page, 'Слои');

    // Информационные слои — тоже слои: удаляем все, кроме одного.
    for (const name of ['Камеры и зоны обзора', 'Тепловая нагрузка зон', 'Сотрудники по зонам']) {
      await layerItem(page, name).getByRole('button', { name: `Удалить слой ${name}` }).click();
    }
    await layerItem(page, 'Очередь по зонам')
      .getByRole('button', { name: 'Удалить слой Очередь по зонам' })
      .click();

    const remaining = panel(page).locator('.layers__item');
    await expect(remaining).toHaveCount(1);
    await expect(
      layerItem(page, 'Основной').getByRole('button', { name: 'Удалить слой Основной' }),
    ).toBeDisabled();

    // Удалённый слой камер добавляется снова: его прежний id ушёл в отставку,
    // новый получает следующий номер, а не отказ.
    await panel(page).getByLabel('Тип нового слоя').selectOption({ label: 'Камеры и зоны обзора' });
    await panel(page).getByRole('button', { name: 'Добавить слой' }).click();
    await expect(layerItem(page, 'Камеры и зоны обзора')).toHaveCount(1);
    await expect(page.locator('.shell__error')).toHaveCount(0);
  });

  test('информационные слои: числа синтетические, план не меняется', async ({ page }) => {
    await page.goto('/');
    await showTab(page, 'Слои');
    await drawZone(page);

    const heat = layerItem(page, 'Тепловая нагрузка зон');
    // Подпись об источнике чисел стоит рядом со слоем, а не в документации.
    await expect(heat.locator('.layers__note')).toContainText('синтетические');

    const before = JSON.parse(await savePlan(page));

    // Включение слоя — это показ: в плане меняется только флаг самого слоя,
    // а зоны, объекты и геометрия остаются теми же.
    await heat.getByRole('button', { name: 'Показывать слой Тепловая нагрузка зон' }).click();
    // Показ слоя — не правка: статус остаётся «сохранено» (D-207, находка operator №11).
    await expect(page.getByText('сохранено', { exact: true })).toBeVisible();
    const shown = JSON.parse(await savePlan(page));
    expect(shown.zones).toEqual(before.zones);
    expect(shown.objects).toEqual(before.objects);
    expect(shown.room).toEqual(before.room);

    // Слой действительно рисует: холст после заливки зоны выглядит иначе.
    const canvas = page.getByTestId('editor-canvas');
    const clean = await canvas.screenshot();
    await heat.getByLabel('Тепловая нагрузка зон, Зона 1 (z_1)').fill('80');
    await expect(page.getByText('есть несохранённые правки')).toBeVisible();
    await expect(async () => {
      expect(await canvas.screenshot()).not.toEqual(clean);
    }).toPass();

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

    const staff = layerItem(page, 'Сотрудники по зонам');
    await staff.getByRole('button', { name: 'Показывать слой Сотрудники по зонам' }).click();
    await expect(staff.locator('.layers__unit').first()).toHaveText('чел.');

    await staff.getByLabel('Сотрудники по зонам, Зона 1 (z_1)').fill('3');
    const saved = JSON.parse(await savePlan(page));
    expect(saved.zones[0].attributes.staffCount).toBe(3);
  });
});
