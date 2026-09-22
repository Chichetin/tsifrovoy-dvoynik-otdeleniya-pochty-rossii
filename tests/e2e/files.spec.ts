/**
 * IO03 в браузере: чем проверяющий начнёт работу.
 *
 * Сценарий D-058 — открыть готовый структурированный план — здесь проверяется
 * на том самом файле, который выложили организаторы: `example_plan.json` из
 * корня репозитория подаётся в кнопку «Открыть существующий» как есть, без конвертации в
 * тесте. Дальше — скачать, открыть заново и получить тот же документ.
 *
 * Отдельно проверяется, что редактор не теряет работу и не подменяет открытый
 * план: битый файл, черновик в localStorage и мусор вместо черновика.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, exportPlan, expectUnsavedEdits } from './fixtures';
import { expandInventoryRows } from './inventory-collapse';
import { showTab } from './side-tabs';

/** Файл организаторов лежит в корне репозитория и в тесте не меняется. */
const EXAMPLE = join(process.cwd(), 'example_plan.json');

/** Ключ черновика из `src/persistence/browser-draft.ts`. */
const DRAFT_KEY = 'ops-twin.draft.v1';

/** Название отделения во втором файле: по нему узнаём черновик на экране. */
const SECOND_PLAN_NAME = 'ОПС-2 (второй файл)';

/**
 * Черновик в localStorage держит план с нужным числом объектов. Подпись времени
 * у «черновик в браузере» появляется уже от стартового пустого плана, поэтому
 * ждать её после «Открыть существующий» недостаточно: под нагрузкой перезагрузка успевала
 * раньше записи открытого файла, и предложение показывало прежний план.
 */
async function draftHolds(page: Page, objects: number): Promise<void> {
  await page.waitForFunction(
    ([key, count]) => {
      // Мусор в хранилище (есть такой тест) — это «ещё не записан», а не сбой ожидания.
      try {
        const raw = window.localStorage.getItem(key as string);
        if (raw === null) return false;
        const draft = JSON.parse(raw) as { text: string };
        return (JSON.parse(draft.text) as { objects: unknown[] }).objects.length === count;
      } catch {
        return false;
      }
    },
    [DRAFT_KEY, objects] as const,
  );
}

/** Строки перечня оборудования — первая таблица панели «Инвентаризация». */
function inventoryRows(page: Page) {
  return page.getByLabel('Инвентаризация').locator('table').first().locator('tbody tr');
}

async function openFile(page: Page, file: string): Promise<void> {
  await page.getByTestId('plan-file-input').setInputFiles(file);
}

/** Ставит первый тип из библиотеки в точку холста. */
async function placeFirstLibraryItem(page: Page, x: number, y: number): Promise<void> {
  await showTab(page, 'Библиотека');
  await page.locator('.library__item').first().click();
  await page.getByTestId('editor-canvas').click({ position: { x, y } });
}

/**
 * Второй файл для сценария «открыл другой план»: тот же пример организаторов,
 * но с другим названием отделения и тремя позициями вместо двенадцати — по
 * названию в предложении черновика видно, какой из двух планов запомнен.
 */
function secondPlanFile(): { name: string; mimeType: string; buffer: Buffer } {
  const source = JSON.parse(readFileSync(EXAMPLE, 'utf8')) as {
    ops: { name: string };
    equipment: unknown[];
  };
  source.ops.name = SECOND_PLAN_NAME;
  source.equipment = source.equipment.slice(0, 3);
  return {
    name: 'second_plan.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(source)),
  };
}

async function download(page: Page): Promise<string> {
  const event = await Promise.all([
    page.waitForEvent('download'),
    exportPlan(page, 'JSON'),
  ]).then(([download]) => download);
  const path = await event.path();
  expect(path).not.toBeNull();
  return path as string;
}

test.describe('файлы плана', () => {
  test('«Создать новый» не пугает на пустом старте, но защищает поставленный объект', async ({ page }) => {
    const dialogs: string[] = [];
    let accept = false;
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void (accept ? dialog.accept() : dialog.dismiss());
    });
    await page.goto('/');

    await page.getByRole('button', { name: 'Создать новый' }).click();
    expect(dialogs).toEqual([]);
    await placeFirstLibraryItem(page, 300, 260);
    await expect(inventoryRows(page)).toHaveCount(1);

    await page.getByRole('button', { name: 'Создать новый' }).click();
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]).toContain('Создать новый план?');
    await expect(inventoryRows(page)).toHaveCount(1);

    accept = true;
    await page.getByRole('button', { name: 'Создать новый' }).click();
    await expect(inventoryRows(page)).toHaveCount(0);
  });

  test('кнопка «Открыть существующий» принимает сырой пример организаторов', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/');
    await expect(page.getByText('Оборудование ещё не размещено')).toBeVisible();

    await openFile(page, EXAMPLE);

    // Двенадцать объектов примера и его зоны — на месте и со своими id.
    await expect(inventoryRows(page)).toHaveCount(12);
    await expect(page.locator('.table__link', { hasText: 'z_client' }).first()).toBeVisible();
    // Перечень свёрнут по умолчанию — первая строка с z_back стоит не среди
    // первых трёх (z_back начинается с восьмого объекта примера).
    await expandInventoryRows(page);
    await expect(page.locator('.table__link', { hasText: 'z_back' }).first()).toBeVisible();

    // Объект примера открывается карточкой по своему идентификатору. Ссылку
    // берём в перечне: тот же объект назван и в находках проверки, а её панель
    // на соседней вкладке и скрыта (D-249). Перечень свёрнут по умолчанию —
    // объект стоит не среди первых трёх, список нужно раскрыть.
    await expandInventoryRows(page);
    await page
      .getByLabel('Инвентаризация')
      .locator('.table__link', { hasText: 'Терминал электронной очереди' })
      .first()
      .click();
    await expect(page.getByTestId('props-id')).toHaveText('eq_kiosk');

    // Пользователю сказано, откуда план и что будет при сохранении.
    await expect(page.getByTestId('files-notice')).toContainText('формата организаторов');
    await expect(page.getByTestId('files-notice')).toContainText('формате редактора');
    await expect(page.getByTestId('organizer-assumptions')).toContainText('Допущения импорта');

    // Зоны нарисованы: площадь помещения и свободный пол посчитаны от плана.
    await expect(page.getByTestId('room-free')).toContainText('м²');

    // Правила команды сомкнулись с примером: ловушка «терминал в ~7 м от входа
    // при норме 3 м» видна в проверке, а не только в unit-тесте.
    await showTab(page, 'Проверка');
    await expect(page.getByLabel('Проверка плана')).toContainText('от главного входа');
    await showTab(page, 'Проверка');
    await expect(page.getByLabel('Проверка плана')).toContainText('не более 3 м');
    expect(errors).toEqual([]);
  });

  test('скачать импортированный пример и открыть его заново — то же состояние', async ({
    page,
  }, testInfo) => {
    await page.goto('/');
    await openFile(page, EXAMPLE);
    await expect(inventoryRows(page)).toHaveCount(12);

    const first = await download(page);
    const savedText = readFileSync(first, 'utf8');
    const saved = JSON.parse(savedText) as {
      schemaVersion: number;
      zones: unknown[];
      objects: unknown[];
    };
    // Сохранённый файл — уже наш формат, а не формат примера.
    expect(saved.schemaVersion).toBe(1);
    expect(saved.zones).toHaveLength(4);
    expect(saved.objects).toHaveLength(12);

    // Чистый лист, затем открываем скачанный файл.
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Создать новый' }).click();
    await expect(page.getByText('Оборудование ещё не размещено')).toBeVisible();

    await openFile(page, first);
    await expect(inventoryRows(page)).toHaveCount(12);
    await expect(page.locator('.table__link', { hasText: 'z_client' }).first()).toBeVisible();
    // Это наш файл, а не пример: подпись про импорт больше не показывается.
    await expect(page.getByTestId('organizer-assumptions')).toHaveCount(0);

    // Повторное сохранение даёт тот же текст — документ вернулся целиком.
    const second = await download(page);
    expect(readFileSync(second, 'utf8')).toBe(savedText);
    await testInfo.attach('импортированный пример', {
      body: savedText,
      contentType: 'application/json',
    });
  });

  test('поле вне формата названо при открытии и не теряется молча', async ({ page }) => {
    await page.goto('/');
    const plan = JSON.parse(readFileSync(join(process.cwd(), 'demo', 'before.json'), 'utf8')) as Record<string, unknown>;
    plan.futureField = { from: 'newer version' };
    (plan.objects as Record<string, unknown>[])[0]!.futureAttr = 1;
    await page.getByTestId('plan-file-input').setInputFiles({
      name: 'newer.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(plan)),
    });
    await expect(inventoryRows(page)).toHaveCount(53);
    const details = page.getByTestId('dropped-fields');
    await expect(details).toContainText('Поля вне формата (2)');
    await details.locator('summary').click();
    await expect(details).toContainText('futureField');
    await expect(details).toContainText('futureAttr');
    // «Создать новый» — чистый лист, предупреждение уходит; обычный файл его не приносит.
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Создать новый' }).click();
    await expect(page.getByTestId('dropped-fields')).toHaveCount(0);
    await openFile(page, join(process.cwd(), 'demo', 'before.json'));
    await expect(page.getByTestId('dropped-fields')).toHaveCount(0);
  });

  test('файл не того формата не подменяет открытый план', async ({ page }) => {
    await page.goto('/');
    await openFile(page, EXAMPLE);
    await expect(inventoryRows(page)).toHaveCount(12);

    await page.getByTestId('plan-file-input').setInputFiles({
      name: 'notes.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"hello": "world"}'),
    });
    await expect(page.getByRole('alert')).toContainText('План не открыт');
    await expect(page.getByRole('alert')).not.toContainText('DOCUMENT_UNREADABLE');
    await expect(page.getByTestId('file-error-details')).toContainText('DOCUMENT_UNREADABLE');
    await expect(inventoryRows(page)).toHaveCount(12);

    await page.getByTestId('plan-file-input').setInputFiles({
      name: 'broken.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"schemaVersion": 1, "zones": ['),
    });
    await expect(page.getByRole('alert')).toContainText('План не открыт');
    await expect(page.getByRole('alert')).not.toContainText('DOCUMENT_UNREADABLE');
    await expect(page.getByTestId('file-error-details')).toContainText('DOCUMENT_UNREADABLE');
    await expect(inventoryRows(page)).toHaveCount(12);
  });

  test('черновик переживает перезагрузку страницы', async ({ page }) => {
    await page.goto('/');
    await openFile(page, EXAMPLE);
    await expect(inventoryRows(page)).toHaveCount(12);
    // Черновик пишется с задержкой и говорит, что он в браузере, а не на диске.
    await expect(page.getByTestId('draft-saved')).toContainText(/черновик в браузере: \d\d:\d\d/);
    await draftHolds(page, 12);

    await page.reload();
    // После перезагрузки план пуст, но черновик предложен, а не применён сам.
    await expect(page.getByText('Оборудование ещё не размещено')).toBeVisible();
    const offer = page.getByTestId('draft-restore');
    await expect(offer).toBeVisible();

    await offer.getByRole('button', { name: 'Восстановить' }).click();
    await expect(inventoryRows(page)).toHaveCount(12);
    await expect(page.locator('.table__link', { hasText: 'z_client' }).first()).toBeVisible();
    await expect(offer).toHaveCount(0);
  });

  test('черновик не затирается, пока на предложение не ответили', async ({ page }) => {
    await page.goto('/');
    await openFile(page, EXAMPLE);
    await draftHolds(page, 12);

    await page.reload();
    await expect(page.getByTestId('draft-restore')).toBeVisible();
    // Ожидание здесь и есть предмет проверки: пустой план не должен записаться
    // поверх черновика по дебаунсу (700 мс), пока пользователь думает.
    await page.waitForTimeout(1_500);

    await page.reload();
    const offer = page.getByTestId('draft-restore');
    await expect(offer).toBeVisible();
    await offer.getByRole('button', { name: 'Восстановить' }).click();
    await expect(inventoryRows(page)).toHaveCount(12);
  });

  test('после «Открыть существующий» и правки черновик снова пишется: предлагают новый, а не старый', async ({
    page,
  }) => {
    await page.goto('/');
    await openFile(page, EXAMPLE);
    await expect(inventoryRows(page)).toHaveCount(12);
    await draftHolds(page, 12);

    await page.reload();
    await expect(page.getByTestId('draft-restore')).toContainText('ОПС-1');

    // Пользователь не ответил на предложение, а открыл другой файл: этим он и
    // ответил — предложение уходит, а запись черновика возобновляется.
    await page.getByTestId('plan-file-input').setInputFiles(secondPlanFile());
    await expect(inventoryRows(page)).toHaveCount(3);
    await expect(page.getByTestId('draft-restore')).toHaveCount(0);

    // Правка второго плана — то, что нельзя потерять при закрытии вкладки.
    await placeFirstLibraryItem(page, 320, 240);
    await expect(inventoryRows(page)).toHaveCount(4);
    // Ждём именно записи правки, а не подписи времени: подпись уже стоит от
    // черновика открытого файла, а дебаунс — 700 мс.
    await draftHolds(page, 4);

    await page.reload();
    const offer = page.getByTestId('draft-restore');
    await expect(offer).toContainText(SECOND_PLAN_NAME);
    await offer.getByRole('button', { name: 'Восстановить' }).click();
    await expect(inventoryRows(page)).toHaveCount(4);
  });

  test('«Удалить» убирает черновик, и после перезагрузки его больше не предлагают', async ({
    page,
  }) => {
    await page.goto('/');
    await openFile(page, EXAMPLE);
    await draftHolds(page, 12);

    await page.reload();
    await page.getByTestId('draft-restore').getByRole('button', { name: 'Удалить' }).click();
    await expect(page.getByTestId('draft-restore')).toHaveCount(0);
    await expect(page.getByText('Оборудование ещё не размещено')).toBeVisible();

    await page.reload();
    await expect(page.getByTestId('draft-restore')).toHaveCount(0);
  });

  test('начатая работа не заменяется черновиком без подтверждения', async ({ page }) => {
    await page.goto('/');
    await openFile(page, EXAMPLE);
    await draftHolds(page, 12);

    await page.reload();
    const offer = page.getByTestId('draft-restore');
    await expect(offer).toBeVisible();

    // Пользователь начал новый план, не ответив на предложение.
    await placeFirstLibraryItem(page, 320, 240);
    await expect(inventoryRows(page)).toHaveCount(1);

    // Playwright по умолчанию отклоняет диалог — правка остаётся на месте.
    await offer.getByRole('button', { name: 'Восстановить' }).click();
    await expect(inventoryRows(page)).toHaveCount(1);
    await expect(offer).toBeVisible();

    // Согласие — и черновик всё-таки открывается, уже как несохранённый план.
    page.once('dialog', (dialog) => void dialog.accept());
    await offer.getByRole('button', { name: 'Восстановить' }).click();
    await expect(inventoryRows(page)).toHaveCount(12);
    await expectUnsavedEdits(page, true);
  });

  test('битый черновик не ломает старт редактора', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.addInitScript(
      ([key]) => window.localStorage.setItem(key as string, '{это не json'),
      [DRAFT_KEY],
    );
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Цифровой двойник ОПС' })).toBeVisible();
    await expect(page.getByTestId('draft-restore')).toHaveCount(0);
    await expect(page.getByText('Оборудование ещё не размещено')).toBeVisible();

    // Редактор работает дальше и перезаписывает мусор своим черновиком.
    await openFile(page, EXAMPLE);
    await expect(inventoryRows(page)).toHaveCount(12);
    await draftHolds(page, 12);
    expect(errors).toEqual([]);
  });

  test('«Экспорт → SVG» скачивает картинку плана и не выдаёт это за сохранение', async ({ page }) => {
    // Находка operator №6: руководителю нечем показать план, кроме скриншота.
    await page.goto('/');
    await openFile(page, join(process.cwd(), 'demo', 'before.json'));
    await showTab(page, 'Инвентаризация');
    const rows = page.getByLabel('Инвентаризация').locator('table').first().locator('tbody tr');
    await expect(rows).toHaveCount(53);

    // Правка, чтобы план стал «несохранённым», — картинка этого не снимает.
    await rows.first().locator('.table__link').first().click();
    await page.keyboard.press('Delete');
    await expect(rows).toHaveCount(52);
    await expectUnsavedEdits(page, true);

    const event = await Promise.all([
      page.waitForEvent('download'),
      exportPlan(page, 'SVG'),
    ]).then(([download]) => download);
    expect(event.suggestedFilename()).toMatch(/\.svg$/);
    const path = await event.path();
    const svg = readFileSync(path as string, 'utf8');

    // Файл — настоящий SVG с каждым объектом плана по id.
    expect(svg.startsWith('<?xml')).toBe(true);
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    const saved = JSON.parse(readFileSync(join(process.cwd(), 'demo', 'before.json'), 'utf8')) as {
      zones: { id: string }[];
      objects: { id: string }[];
    };
    for (const zone of saved.zones) expect(svg).toContain(`data-id="${zone.id}"`);
    // 52 объекта на картинке: удалённого нет, остальные есть.
    expect((svg.match(/<g transform="translate/g) ?? []).length).toBe(52);

    // Картинка — не сохранение: правки по-прежнему несохранённые.
    await expectUnsavedEdits(page, true);
  });

  test('«Экспорт → SVG» не возвращает содержимое скрытого слоя', async ({ page }) => {
    const source = JSON.parse(
      readFileSync(join(process.cwd(), 'demo', 'before.json'), 'utf8'),
    ) as {
      room: { id: string };
      layers: { visible: boolean }[];
      zones: { id: string }[];
      objects: { id: string }[];
    };
    for (const layer of source.layers) layer.visible = false;
    await page.goto('/');
    await page.getByTestId('plan-file-input').setInputFiles({
      name: 'hidden-layers.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(source)),
    });

    const event = await Promise.all([
      page.waitForEvent('download'),
      exportPlan(page, 'SVG'),
    ]).then(([download]) => download);
    const path = await event.path();
    const svg = readFileSync(path as string, 'utf8');

    expect(svg).toContain(`data-id="${source.room.id}"`);
    for (const zone of source.zones) expect(svg).not.toContain(`data-id="${zone.id}"`);
    for (const object of source.objects) expect(svg).not.toContain(`data-id="${object.id}"`);
  });

  test('«Экспорт → PNG» скачивает картинку, а меню слушается клавиатуры (D-255)', async ({ page }) => {
    await page.goto('/');
    await openFile(page, join(process.cwd(), 'demo', 'before.json'));
    await showTab(page, 'Инвентаризация');
    const rows = page.getByLabel('Инвентаризация').locator('table').first().locator('tbody tr');
    await expect(rows).toHaveCount(53);

    // Правка, чтобы план стал «несохранённым», — картинка этого не снимает.
    await rows.first().locator('.table__link').first().click();
    await page.keyboard.press('Delete');
    await expect(rows).toHaveCount(52);
    await expectUnsavedEdits(page, true);

    // Меню открывается с клавиатуры и закрывается Escape, не выгружая ничего.
    const trigger = page.getByRole('button', { name: 'Экспорт' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu', { name: 'Экспорт' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /JSON/ })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: /PNG/ })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu', { name: 'Экспорт' })).toHaveCount(0);
    await expect(trigger).toBeFocused();
    // Стрелка вверх на кнопке — меню открыто на последнем пункте.
    await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('menuitem', { name: /SVG/ })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();

    const event = await Promise.all([
      page.waitForEvent('download'),
      exportPlan(page, 'PNG'),
    ]).then(([download]) => download);
    expect(event.suggestedFilename()).toMatch(/\.png$/);
    const path = await event.path();
    const png = readFileSync(path as string);
    // Настоящий PNG: сигнатура файла и непустой растр.
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.byteLength).toBeGreaterThan(1000);

    await expect(page.getByTestId('files-notice')).toContainText('.png');

    // Картинка — не сохранение: правки по-прежнему несохранённые.
    await expectUnsavedEdits(page, true);
  });
});
