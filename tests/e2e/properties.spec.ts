/**
 * U06 в браузере: карточка свойств.
 *
 * Три обещания карточки: смена типа не трогает идентификатор и положение,
 * неверное значение не попадает в план, а поля атрибутов берутся из
 * справочника — включая справочник, приехавший внутри чужого файла.
 */

import { readFileSync } from 'node:fs';
import { expect, test, type Page , exportPlan } from './fixtures';
import { showTab } from './side-tabs';

const card = (page: Page) => page.getByLabel('Свойства');

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

async function placeFromLibrary(page: Page, label: string, x: number, y: number): Promise<void> {
  await showTab(page, 'Библиотека');
  await page.locator('.library__item', { hasText: label }).first().click();
  await clickCanvas(page, x, y);
  await page.getByRole('button', { name: 'Выбор', exact: true }).click();
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

/** Выбор объекта: по строке инвентаризации, а не попаданием мышью в фигуру. */
async function selectPlacedObject(page: Page): Promise<void> {
  await page
    .getByLabel('Инвентаризация')
    .locator('table')
    .first()
    .locator('tbody tr')
    .first()
    .getByRole('button')
    .first()
    .click();
}

test.describe('карточка свойств', () => {
  test('без выбора карточки свойств нет вовсе; выбор показывает её над вкладками (D-249)', async ({
    page,
  }) => {
    await page.goto('/');
    // «Свойства» — не вкладка и не свёрнутый раздел: показывать нечего, и
    // колонка отдана открытой панели целиком.
    await expect(card(page)).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /^Свойства/ })).toHaveCount(0);

    await clickCanvas(page, 300, 200);

    await expect(card(page)).toBeVisible();
    await expect(card(page).getByTestId('props-id')).toHaveText('room_main');
    // «×» снимает выделение, и карточка снова исчезает.
    await page.getByRole('button', { name: 'Снять выделение' }).click();
    await expect(card(page)).toHaveCount(0);
  });

  test('карточка помещения: название плана становится именем файла, потолок поднимает наружные стены', async ({
    page,
  }) => {
    await page.goto('/');
    // Помещение выбирается кликом по полу — там, где нет зон, объектов и стен.
    await clickCanvas(page, 300, 200);
    await expect(card(page).getByTestId('props-id')).toHaveText('room_main');
    await expect(card(page).getByTestId('props-room-area')).toContainText('108,00 м²');

    await card(page).getByLabel('Название плана').fill('ОПС 115534 Тестовое');
    await card(page).getByLabel('Высота потолка, м').fill('3.4');

    const download = await Promise.all([
      page.waitForEvent('download'),
      exportPlan(page, 'JSON'),
    ]).then(([event]) => event);
    expect(download.suggestedFilename()).toBe('ОПС-115534-Тестовое.json');
    const saved = JSON.parse(readFileSync((await download.path()) as string, 'utf8'));
    expect(saved.name).toBe('ОПС 115534 Тестовое');
    expect(saved.room.ceilingHeight_m).toBe(3.4);
    // Четыре наружные стены стартовой коробки поднялись вместе с потолком.
    expect(saved.walls.map((w: { height_m: number }) => w.height_m)).toEqual([3.4, 3.4, 3.4, 3.4]);

    // Пустое название отклоняется у поля, план остаётся с прежним именем.
    await card(page).getByLabel('Название плана').fill('   ');
    await expect(card(page).getByRole('alert')).toContainText('название');
    expect(JSON.parse(await savePlan(page)).name).toBe('ОПС 115534 Тестовое');
  });

  test('смена типа сохраняет идентификатор и положение', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/');
    await placeFromLibrary(page, 'Рабочее место оператора', 300, 260);
    await selectPlacedObject(page);

    await expect(card(page).getByTestId('props-id')).toHaveText('eq_1');
    const x = await card(page).getByLabel('X, м').inputValue();
    const y = await card(page).getByLabel('Y, м').inputValue();

    await card(page).getByLabel('Тип оборудования').selectOption('ot_parcel_rack');

    await expect(card(page).getByTestId('props-id')).toHaveText('eq_1');
    await expect(card(page).getByLabel('X, м')).toHaveValue(x);
    await expect(card(page).getByLabel('Y, м')).toHaveValue(y);

    const saved = JSON.parse(await savePlan(page));
    expect(saved.objects).toHaveLength(1);
    expect(saved.objects[0].id).toBe('eq_1');
    expect(saved.objects[0].typeId).toBe('ot_parcel_rack');

    expect(errors).toEqual([]);
  });

  test('неверное число не коммитится и объясняется у поля', async ({ page }) => {
    await page.goto('/');
    await placeFromLibrary(page, 'Рабочее место оператора', 300, 260);
    await selectPlacedObject(page);

    const height = card(page).getByLabel('Высота, м');
    const before = await height.inputValue();

    // Ноль высоты документ не загрузит, поэтому команда его отклоняет.
    await height.fill('0');
    await expect(card(page).getByRole('alert')).toContainText('height_m');
    await expect(height).toHaveValue('0');

    const saved = JSON.parse(await savePlan(page));
    expect(String(saved.objects[0].height_m)).toBe(before);

    // Исправленное значение снимает пометку и уходит в план.
    await height.fill('1.2');
    await expect(card(page).getByRole('alert')).toHaveCount(0);
    expect(JSON.parse(await savePlan(page)).objects[0].height_m).toBe(1.2);

    // Пустое поле координаты — это не ноль: у поля пометка, в плане прежнее X.
    const x = card(page).getByLabel('X, м');
    const keptX = Number(await x.inputValue());
    await x.fill('');
    await expect(card(page).getByRole('alert')).toContainText('Нужно число');
    expect(JSON.parse(await savePlan(page)).objects[0].position[0]).toBe(keptX);
  });

  test('атрибуты зоны приходят из справочника и сохраняются', async ({ page }) => {
    await page.goto('/');
    await drawZone(page);
    await page.locator('.table__link', { hasText: 'z_1' }).first().click();

    await expect(card(page).getByTestId('props-id')).toHaveText('z_1');
    await card(page).getByLabel('Название').fill('Клиентский зал');
    await card(page).getByLabel('Загрузка зоны, %').fill('65');
    await card(page).getByLabel('Открыта для клиентов').uncheck();

    const saved = JSON.parse(await savePlan(page));
    expect(saved.zones[0].name).toBe('Клиентский зал');
    expect(saved.zones[0].attributes.loadPercent).toBe(65);
    expect(saved.zones[0].attributes.publicAccess).toBe(false);

    // Очистка атрибута — это null («значения нет»), а не ноль (D-021).
    await card(page).getByLabel('Загрузка зоны, %').fill('');
    const cleared = JSON.parse(await savePlan(page));
    expect(cleared.zones[0].attributes.loadPercent).toBeNull();
  });

  test('новый атрибут в справочнике файла даёт поле без правки кода', async ({ page }) => {
    await page.goto('/');
    await placeFromLibrary(page, 'Рабочее место оператора', 300, 260);

    // Правим только данные: тип оборудования в справочнике, который едет
    // внутри файла плана. Код карточки не знает про этот атрибут ничего.
    const plan = JSON.parse(await savePlan(page));
    plan.catalog.objectTypes.push({
      id: 'ot_team_counter',
      label: 'Стойка выдачи (тип команды)',
      category: 'Собственный тип',
      defaultSize_m: [1.2, 0.6],
      defaultHeight_m: 1.1,
      defaultBase_m: 0,
      physical: true,
      occupiesFloor: true,
      symbol: 'rect',
      color: '#0B7285',
      attributes: [
        { key: 'windowNumber', label: 'Номер окна', type: 'number', required: false },
        { key: 'selfService', label: 'Самообслуживание', type: 'boolean', required: false },
      ],
      provenance: 'Синтетическое допущение команды: тип добавлен правкой справочника.',
    });
    plan.objects[0].typeId = 'ot_team_counter';

    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Создать новый' }).click();
    await page.getByTestId('plan-file-input').setInputFiles({
      name: 'custom-type.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(plan)),
    });

    await selectPlacedObject(page);
    await expect(card(page).getByLabel('Номер окна')).toBeVisible();
    await card(page).getByLabel('Номер окна').fill('4');
    await card(page).getByLabel('Самообслуживание').check();

    const saved = JSON.parse(await savePlan(page));
    expect(saved.objects[0].attributes.windowNumber).toBe(4);
    expect(saved.objects[0].attributes.selfService).toBe(true);
  });
});
