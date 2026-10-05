import { readFileSync } from 'node:fs';
import { expect, test, exportPlan, passPhysicsBlock } from './fixtures';
import { expandInventoryRows } from './inventory-collapse';

const before = JSON.parse(readFileSync('demo/before.json', 'utf8'));
const after = JSON.parse(readFileSync('demo/after.json', 'utf8'));
async function openDemo(page: import('@playwright/test').Page, label: string) {
  await page.getByRole('button', { name: 'Файл' }).click();
  await page.getByRole('menuitem', { name: label }).click();
}
async function save(page: import('@playwright/test').Page) {
  const downloading = page.waitForEvent('download');
  await exportPlan(page, 'JSON');
  await passPhysicsBlock(page);
  const download = await downloading;
  return { path: (await download.path())!, plan: JSON.parse(readFileSync((await download.path())!, 'utf8')) };
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }]) {
  test(`первый вход → выбор демо → правка → сохранить → открыть (${viewport.width})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    // Reopen the real first step: fixture only suppresses automatic tour display.
    await page.getByRole('button', { name: 'Обучение', exact: true }).click();
    await page.getByRole('button', { name: 'Исходный демо-план', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Обучение' })).toBeHidden();
    await expect(page.getByTestId('files-notice')).toContainText(before.name);
    const initial = await save(page);
    expect(initial.plan).toEqual(before);
    // Use the real inventory and properties rather than test-only store access.
    await expandInventoryRows(page);
    await page.locator('.table__link', { hasText: 'Рабочее место оператора' }).first().click();
    await page.getByLabel('Свойства').getByLabel('Название', { exact: true }).fill('Демо — моя правка');
    const edited = await save(page);
    expect(edited.plan.objects.some((object: { label: string }) => object.label === 'Демо — моя правка')).toBe(true);
    await page.getByTestId('plan-file-input').setInputFiles(edited.path);
    expect((await save(page)).plan).toEqual(edited.plan);
    await page.getByRole('button', { name: 'Файл' }).focus();
    await page.keyboard.press('ArrowDown');
    // Меню открывается на первом пункте; демо-планы идут дальше по стрелке вниз.
    await expect(page.getByRole('menuitem', { name: 'Создать новый' })).toBeFocused();
    await page.getByRole('menuitem', { name: 'Исходный демо-план' }).focus();
    await expect(page.getByRole('menuitem', { name: 'Исходный демо-план' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Изменённый демо-план' })).toBeFocused();
    await page.screenshot({ path: `docs/verification/2026-09-28-open-demo-${viewport.width}.png` });
    page.once('dialog', (dialog) => void dialog.accept());
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('files-notice')).toContainText(after.name);
    expect((await save(page)).plan).toEqual(after);
    const header = await page.locator('.shell__bar').boundingBox();
    const fileGroup = await page.getByRole('group', { name: 'Файл плана' }).boundingBox();
    expect(fileGroup!.x + fileGroup!.width).toBeLessThanOrEqual(viewport.width);
    expect(fileGroup!.y + fileGroup!.height).toBeLessThanOrEqual(header!.y + header!.height);
  });
}

test('отказ замены и HTTP/JSON ошибки сохраняют открытый план', async ({ page }) => {
  await page.goto('/');
  await openDemo(page, 'Изменённый демо-план');
  await expect(page.getByTestId('files-notice')).toContainText(after.name);
  // Сохранённый план заменяется без вопроса (#141). Вопрос задаёт только
  // несохранённая правка — делаем её.
  await expandInventoryRows(page);
  await page.locator('.table__link', { hasText: 'Рабочее место оператора' }).first().click();
  const card = page.getByLabel('Свойства');
  const editedId = await card.getAttribute('data-entity-id');
  await card.getByLabel('Название', { exact: true }).fill('Демо — моя правка');
  await card.getByLabel('Название', { exact: true }).press('Tab');
  const edited = structuredClone(after);
  edited.objects.find((object: { id: string }) => object.id === editedId).label = 'Демо — моя правка';
  let asked = 0;
  page.once('dialog', (dialog) => { asked += 1; void dialog.dismiss(); });
  await openDemo(page, 'Исходный демо-план');
  await expect.poll(() => asked).toBe(1);
  expect((await save(page)).plan).toEqual(edited);
  // Дальше вопрос может быть или не быть: план сохранён. Ошибка загрузки всё
  // равно оставляет открытый план.
  page.on('dialog', (dialog) => void dialog.accept());
  await page.route('**/demo/before.json', (route) => route.fulfill({ status: 503, body: 'unavailable' }));
  await openDemo(page, 'Исходный демо-план');
  await expect(page.locator('.files__error')).toContainText('HTTP 503');
  expect((await save(page)).plan).toEqual(edited);
  await page.unroute('**/demo/before.json');
  await page.route('**/demo/before.json', (route) => route.fulfill({ body: '{broken' }));
  await openDemo(page, 'Исходный демо-план');
  await expect(page.locator('.files__error')).toContainText('не соответствует');
  expect((await save(page)).plan).toEqual(edited);
});

test('поздний запрос демо не заменяет более новый выбор', async ({ page }) => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/demo/before.json', async (route) => {
    await waiting;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(before) }).catch(() => undefined);
  });
  await page.goto('/');
  await openDemo(page, 'Исходный демо-план');
  await expect(page.getByTestId('files-loading')).toContainText('загружаем демо');
  await openDemo(page, 'Изменённый демо-план');
  await expect(page.getByTestId('files-notice')).toContainText(after.name);
  release();
  expect((await save(page)).plan).toEqual(after);
});

type Point = [number, number];
type Wall = { id: string; from: Point; to: Point };
type Opening = { id: string; wallId: string; offset_m: number; width_m: number; kind: string; height_m: number };
type Zone = { id: string; typeId: string; name: string; parentId: string | null; polygon: Point[]; attributes: object };
type PlanObject = { id: string; typeId: string; label: string; position: Point; zoneId: string | null; attributes: object };

/** Клик с Alt (без привязки, D-209) в точку плана по видимой области, которую публикует холст (D-130). */
async function clickWorld(page: import('@playwright/test').Page, [x, y]: Point) {
  const box = (await page.locator('.editor-canvas canvas').first().boundingBox())!;
  const raw = (await page.getByTestId('editor-canvas').getAttribute('data-visible'))!;
  const [minX, minY, maxX, maxY] = raw.split(',').map(Number) as [number, number, number, number];
  await page.keyboard.down('Alt');
  await page.mouse.click(box.x + ((x - minX) / (maxX - minX)) * box.width, box.y + ((maxY - y) / (maxY - minY)) * box.height);
  await page.keyboard.up('Alt');
}

// #204: before.json собирает demo/build.ts командами редактора. Здесь тот же план
// рисуется руками в интерфейсе — контур, перегородки, проёмы, 8 зон и первые
// объекты — и сверяется с файлом. id стен, проёмов и зон редактор выдаёт свои
// (w_7, z_3), поэтому они сопоставляются по порядку рисования.
test('before.json повторяется в редакторе: контур, перегородки, проёмы, зоны и объекты (#204)', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  page.on('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Файл' }).click();
  await page.getByRole('menuitem', { name: 'Создать новый' }).click();
  // Пустое помещение 12 × 9 м; контуру демо нужно 15 × 10 м на экране.
  await page.getByRole('button', { name: 'Уменьшить', exact: true }).click();
  await page.getByRole('button', { name: 'Уменьшить', exact: true }).click();
  const select = () => page.getByRole('button', { name: 'Выбор', exact: true }).click();
  const card = page.getByLabel('Свойства', { exact: true });

  await page.getByRole('button', { name: 'Файл' }).click();
  await page.getByRole('menuitem', { name: 'Изменить внешний контур отделения…' }).click();
  const boundary = before.room.boundary as Point[];
  for (const point of [...boundary, boundary[0]!]) await clickWorld(page, point);
  await page.getByRole('button', { name: 'Применить внешний контур' }).click();
  await select();

  const walls = before.walls as Wall[];
  for (const wall of walls.slice(boundary.length)) {
    await page.getByRole('button', { name: 'Перегородка', exact: true }).click();
    await clickWorld(page, wall.from);
    await clickWorld(page, wall.to);
    await select();
    await card.getByLabel('Толщина, м').fill(String((wall as Wall & { thickness_m: number }).thickness_m));
    await page.keyboard.press('Escape');
  }

  for (const opening of before.openings as Opening[]) {
    const wall = walls.find((entry) => entry.id === opening.wallId)!;
    const t = (opening.offset_m + opening.width_m / 2) / Math.hypot(wall.to[0] - wall.from[0], wall.to[1] - wall.from[1]);
    await page.getByRole('button', { name: 'Проём', exact: true }).click();
    const controls = page.getByLabel('Создание проёма');
    await controls.getByLabel('Вид проёма').selectOption(opening.kind);
    await controls.getByLabel('Ширина проёма, м').fill(String(opening.width_m));
    await clickWorld(page, [wall.from[0] + (wall.to[0] - wall.from[0]) * t, wall.from[1] + (wall.to[1] - wall.from[1]) * t]);
    await page.getByRole('button', { name: 'Установить проём' }).click();
    await select();
    await card.getByLabel('Высота, м').fill(String(opening.height_m));
    await page.keyboard.press('Escape');
  }

  for (const zone of before.zones as Zone[]) {
    await page.getByRole('toolbar', { name: 'Инструменты плана' }).getByRole('button', { name: 'Зона', exact: true }).click();
    for (const point of [...zone.polygon, zone.polygon[0]!]) await clickWorld(page, point);
    await select();
    await card.getByLabel('Тип зоны').selectOption(zone.typeId);
    await card.getByLabel('Название', { exact: true }).fill(zone.name);
    await card.getByLabel('Название', { exact: true }).press('Tab');
    await page.keyboard.press('Escape');
  }

  const objects = (before.objects as PlanObject[]).slice(0, 6);
  for (const object of objects) {
    const type = before.catalog.objectTypes.find((entry: { id: string }) => entry.id === object.typeId);
    await page.locator('.library__item', { hasText: type.label }).first().click();
    await clickWorld(page, object.position);
    await select();
    await card.getByLabel('Название', { exact: true }).fill(object.label);
    await card.getByLabel('Название', { exact: true }).press('Tab');
    await page.keyboard.press('Escape');
  }

  const drawn = (await save(page)).plan;
  const wallId = new Map((drawn.walls as Wall[]).map((wall, index) => [wall.id, walls[index]!.id]));
  const zoneId = new Map((drawn.zones as Zone[]).map((zone, index) => [zone.id, (before.zones as Zone[])[index]!.id]));
  expect(drawn.room).toEqual(before.room);
  expect((drawn.walls as Wall[]).map((wall) => ({ ...wall, id: wallId.get(wall.id) }))).toEqual(before.walls);
  expect((drawn.openings as Opening[]).map((opening) => ({ ...opening, id: undefined, wallId: wallId.get(opening.wallId) })))
    .toEqual((before.openings as Opening[]).map((opening) => ({ ...opening, id: undefined })));
  // Атрибуты зон (нагрузка, штат) и объектов (инвентарный номер, статус) —
  // данные обхода и расчёта, а не рисования: их сверка — в других тестах.
  expect((drawn.zones as Zone[]).map((zone) => ({ ...zone, id: zoneId.get(zone.id), parentId: zone.parentId === null ? null : zoneId.get(zone.parentId), attributes: undefined })))
    .toEqual((before.zones as Zone[]).map((zone) => ({ ...zone, attributes: undefined })));
  expect((drawn.objects as PlanObject[]).map((object) => ({ ...object, zoneId: zoneId.get(object.zoneId!), attributes: undefined })))
    .toEqual(objects.map((object) => ({ ...object, attributes: undefined })));
});
