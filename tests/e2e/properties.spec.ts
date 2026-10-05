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
import { closeSettings, openSettings } from './settings';
import type { PlanDocument } from '../../src/contracts/model';

const card = (page: Page) => page.getByLabel('Свойства');

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
  test('пустой статус не становится рабочим из-за порядка палитры при открытии файла',async({page})=>{
    await page.goto('/');
    await placeFromLibrary(page,'Рабочее место оператора',300,260);
    const fixture=JSON.parse(await savePlan(page)) as PlanDocument;
    const representation=fixture.catalog.layerTypes.find(type=>type.representation.kind==='object-color')!.representation;
    if(representation.kind!=='object-color')throw new Error('нет цветового слоя');
    representation.values.sort((a,b)=>Number(b.value==='working')-Number(a.value==='working'));
    representation.defaultValue='unknown';
    delete fixture.objects[0]!.attributes[representation.attribute];
    await page.getByTestId('plan-file-input').setInputFiles({name:'missing-status.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
    await selectPlacedObject(page);
    const status=card(page).getByRole('combobox',{name:'Состояние',exact:true});
    await expect(status).toHaveValue('unknown');
    expect((JSON.parse(await savePlan(page)) as PlanDocument).objects[0]!.attributes).toEqual(fixture.objects[0]!.attributes);
    if(process.env.UPDATE_SNAPSHOTS==='1'){
      await status.scrollIntoViewIfNeeded();
      await page.screenshot({path:'docs/verification/2026-10-02-equipment-status-default.png'});
    }
    await status.selectOption('repair');
    const changed=JSON.parse(await savePlan(page)) as PlanDocument;
    expect(changed.objects[0]!.attributes[representation.attribute]).toBe('repair');
    await page.getByTestId('plan-file-input').setInputFiles({name:'changed-status.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(changed))});
    await selectPlacedObject(page);await expect(status).toHaveValue('repair');
  });
  test('состояние оборудования выбирается по понятным названиям из каталога', async ({ page }) => {
    await page.goto('/');
    await placeFromLibrary(page, 'Рабочее место оператора', 300, 260);
    await selectPlacedObject(page);

    const status = card(page).getByRole('combobox', { name: 'Состояние', exact: true });
    await expect(status).toHaveValue('unknown');
    await expect(status.locator('option')).toHaveText(['Не указано', 'Работает', 'В ремонте', 'Списано']);
    await status.selectOption({ label: 'В ремонте' });

    const saved = JSON.parse(await savePlan(page)) as { objects: { attributes: Record<string, unknown> }[] };
    expect(saved.objects[0]?.attributes.equipmentStatus).toBe('repair');
  });

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
    await expect(card(page)).toHaveAttribute('data-entity-id', 'room_main');
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
    await expect(card(page)).toHaveAttribute('data-entity-id', 'room_main');
    await expect(card(page).getByTestId('props-room-area')).toContainText('108,00 м²');

    // Название плана и высота потолка — в окне «Настройки», раздел «План» (D-350).
    const settings = await openSettings(page, 'План');
    await settings.getByLabel('Название плана').fill('ОПС 115534 Тестовое');
    await settings.getByLabel('Высота потолка, м').fill('3.4');
    await closeSettings(page);

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
    const refusal = await openSettings(page, 'План');
    await refusal.getByLabel('Название плана').fill('   ');
    await expect(refusal.getByRole('alert')).toContainText('название');
    await closeSettings(page);
    expect(JSON.parse(await savePlan(page)).name).toBe('ОПС 115534 Тестовое');
  });

  test('смена типа сохраняет идентификатор и положение', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/');
    await placeFromLibrary(page, 'Рабочее место оператора', 300, 260);
    await selectPlacedObject(page);

    await expect(card(page)).toHaveAttribute('data-entity-id', 'eq_1');
    const x = await card(page).getByLabel('X, м').inputValue();
    const y = await card(page).getByLabel('Y, м').inputValue();

    await card(page).getByLabel('Тип оборудования').selectOption('ot_parcel_rack');

    await expect(card(page)).toHaveAttribute('data-entity-id', 'eq_1');
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
    // Зона выбирается кликом по её полу — там, где нет объектов.
    await clickCanvas(page, 300, 270);

    await expect(card(page)).toHaveAttribute('data-entity-id', 'z_1');
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
    await page.getByRole('button', { name: 'Файл' }).click();
    await page.getByRole('menuitem', { name: 'Создать новый' }).click();
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

test.describe('карточка свойств помещается в колонку', () => {
  for (const width of [1280, 1440]) {
    test(`на ${width} px правый край каждого поля — внутри карточки`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      // Центр холста — середина пустого помещения. Точка (300, 260) на 1280 px
      // попадает к главному входу, и правило #104 отклоняет постановку.
      const canvasBox = await page.getByTestId('editor-canvas').boundingBox();
      if (canvasBox === null) throw new Error('холст не отрисован');
      await placeFromLibrary(page, 'Рабочее место оператора', canvasBox.width / 2, canvasBox.height / 2);
      await selectPlacedObject(page);
      await expect(card(page).getByLabel('Y, м')).toBeVisible();

      const cardBox = await card(page).boundingBox();
      if (cardBox === null) throw new Error('карточка не отрисована');
      expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(width);

      const fields = card(page).locator('input:visible, select:visible');
      const count = await fields.count();
      expect(count).toBeGreaterThan(5);
      const overflow: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const box = await fields.nth(index).boundingBox();
        const label = (await fields.nth(index).getAttribute('aria-label')) ?? `#${index}`;
        if (box !== null && box.x + box.width > cardBox.x + cardBox.width + 0.5) {
          overflow.push(`${label}: ${Math.round(box.x + box.width)} > ${Math.round(cardBox.x + cardBox.width)}`);
        }
      }
      expect(overflow).toEqual([]);
    });
  }

  test('смена типа не затирает ручное название зоны (#215)', async ({ page }) => {
    await page.goto('/');
    await drawZone(page);
    await clickCanvas(page, 300, 260);
    await expect(card(page).getByLabel('Тип зоны')).toBeVisible();

    await card(page).getByLabel('Название').fill('Склад посылок');
    await card(page).getByLabel('Тип зоны').selectOption({ label: 'Зона ожидания' });

    await expect(card(page).getByLabel('Название')).toHaveValue('Склад посылок');
    await expect(card(page).getByLabel('Тип зоны')).toHaveValue('zt_waiting');
    expect(JSON.parse(await savePlan(page)).zones[0].name).toBe('Склад посылок');
  });
});
