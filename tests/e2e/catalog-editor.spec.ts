/**
 * Справочник правится из интерфейса: специалист по инвентаризации добавляет
 * тип оборудования, атрибут и правило без правки JSON (находка operator №5).
 * Всё добавленное доходит до библиотеки, карточки, проверки и файла.
 * Справочник живёт в окне «Настройки», разделы «Оборудование», «Зоны» и
 * «Правила» (D-350). Окно модальное: перед работой с планом его закрывают.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page , exportPlan } from './fixtures';
import { expandCatalogTypes, expandCatalogZoneTypes, expandInventoryRows } from './inventory-collapse';
import { closeSettings, openSettings, settingsDialog } from './settings';
import { showProps, showTab } from './side-tabs';

const panel = (page: Page) => settingsDialog(page);

/** The key field is under «дополнительно»; without it the key comes from the label. */
async function fillAttributeKey(page: Page, key: string): Promise<void> {
  const more = panel(page).getByTestId('catalog-attr-more');
  if ((await more.getAttribute('aria-expanded')) !== 'true') await more.click();
  await panel(page).getByTestId('catalog-attr-key').fill(key);
}

type SavedPlan = {
  catalog: {
    objectTypes: { id: string; label: string; attributes: { key: string }[] }[];
    zoneTypes: { id: string; label: string; attributes: { key: string }[] }[];
    rules: { id: string; source: string }[];
  };
  objects: { typeId: string; attributes: Record<string, unknown> }[];
  zones: { id: string; typeId: string; attributes: Record<string, unknown> }[];
};

async function savePlan(page: Page): Promise<SavedPlan> {
  const event = await Promise.all([
    page.waitForEvent('download'),
    exportPlan(page, 'JSON'),
  ]).then(([d]) => d);
  return JSON.parse(readFileSync((await event.path()) as string, 'utf8'));
}

test('новый тип, атрибут и правило из справочника доходят до библиотеки, плана и файла', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.editor-canvas canvas').first()).toBeVisible();

  await openSettings(page, 'Оборудование');

  // Тип: «Сейф ОПС» — появляется в списке типов и в библиотеке слева.
  await panel(page).getByTestId('catalog-type-label').fill('Сейф ОПС');
  await panel(page).getByTestId('catalog-add-type').click();
  await expect(panel(page).getByTestId('catalog-error')).toHaveCount(0);
  await expect(panel(page).getByTestId('catalog-types')).toContainText('Сейф ОПС');

  // Атрибут у нового типа (он выбран после добавления).
  await fillAttributeKey(page, 'condition');
  await panel(page).getByTestId('catalog-attr-label').fill('Состояние');
  await panel(page).getByTestId('catalog-attr-default').fill('исправен');
  await panel(page).getByTestId('catalog-add-attr').click();
  await expect(panel(page).getByTestId('catalog-error')).toHaveCount(0);
  await expect(panel(page).getByTestId('catalog-attributes')).toContainText('Состояние');
  await closeSettings(page);
  const library = page.getByLabel('Библиотека оборудования');
  await expect(library.getByRole('button', { name: /Сейф ОПС/ })).toBeVisible();

  // Поставить объект нового типа на план: он в перечне, атрибут в карточке.
  await library.getByRole('button', { name: /Сейф ОПС/ }).click();
  await page.getByTestId('editor-canvas').click({ position: { x: 300, y: 260 } });
  await showTab(page, 'Инвентаризация');
  const rows = page.getByLabel('Инвентаризация').locator('table').first().locator('tbody tr');
  await expect(rows).toHaveCount(1);
  await page.getByRole('button', { name: 'Выбор', exact: true }).click();
  await rows.first().locator('.table__link').first().click();
  await expect(await showProps(page)).toContainText('Состояние');

  // Дальше снова правим справочник. Новый тип — в конце свёрнутого списка.
  await expandCatalogTypes(page);
  // Теперь тип используется — удалить его из справочника нельзя.
  const typeRow = panel(page).getByTestId('catalog-types').locator('li', { hasText: 'Сейф ОПС' });
  await expect(typeRow.getByRole('button', { name: 'удалить' })).toBeDisabled();

  // Правило: в клиентской зоне не меньше двух сейфов — сразу в проверке.
  await openSettings(page, 'Правила');
  await panel(page).getByTestId('catalog-rule-zone').selectOption({ index: 1 });
  await panel(page).getByTestId('catalog-rule-object').selectOption({ label: 'Сейф ОПС' });
  await panel(page).getByTestId('catalog-rule-min').fill('2');
  await panel(page).getByTestId('catalog-add-rule').click();
  await expect(panel(page).getByTestId('catalog-error')).toHaveCount(0);
  // Правило команды подписано «справочник проекта» (#100), в файле — team-assumption.
  const ruleRow = panel(page).getByTestId('catalog-rules').locator('li', { hasText: 'Сейф ОПС' });
  await expect(ruleRow).toContainText('справочник проекта');
  await closeSettings(page);

  // Всё уезжает в файл.
  const saved = await savePlan(page);
  const added = saved.catalog.objectTypes.find((t) => t.label === 'Сейф ОПС');
  expect(added).toBeDefined();
  expect(added?.attributes.map((a) => a.key)).toContain('condition');
  expect(saved.objects[0]?.typeId).toBe(added?.id);
  expect(saved.objects[0]?.attributes.condition).toBe('исправен');
  expect(saved.catalog.rules.some((r) => r.source === 'team-assumption')).toBe(true);

  expect(errors).toEqual([]);
});

test('обязательный атрибут без умолчания отклоняется с объяснением, план не меняется', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'demo', 'before.json'));
  await expect(page.getByTestId('files-notice')).toContainText('открыт');
  await openSettings(page, 'Оборудование');

  // Выбрать первый тип из списка и попробовать добавить обязательный атрибут.
  await panel(page).getByTestId('catalog-types').locator('li').first().locator('.table__link').first().click();
  await fillAttributeKey(page, 'serial');
  await panel(page).getByTestId('catalog-attr-label').fill('Серийный номер');
  await panel(page).getByTestId('catalog-attr-required').check();
  await panel(page).getByTestId('catalog-add-attr').click();

  await expect(panel(page).getByTestId('catalog-error')).toBeVisible();
  await expect(panel(page).getByTestId('catalog-attributes')).not.toContainText('Серийный номер');

  // Дробная граница правила отклоняется сразу: файл такую не принял бы при сохранении.
  await openSettings(page, 'Правила');
  const rulesBefore = await panel(page).getByTestId('catalog-rules').locator('li').count();
  await panel(page).getByTestId('catalog-rule-zone').selectOption({ index: 1 });
  await panel(page).getByTestId('catalog-rule-object').selectOption({ index: 1 });
  await panel(page).getByTestId('catalog-rule-min').fill('1,5');
  await panel(page).getByTestId('catalog-add-rule').click();
  await expect(panel(page).getByTestId('catalog-error')).toContainText('целые числа');
  await expect(panel(page).getByTestId('catalog-rules').locator('li')).toHaveCount(rulesBefore);

  // У камеры угол и дальность обзора читает слой «Камеры и зоны обзора» — рядом с
  // атрибутом об этом сказано до клика «удалить». Список типов свёрнут по
  // умолчанию — «Камера» стоит не среди первых трёх, список нужно раскрыть.
  await expandCatalogTypes(page);
  await panel(page).getByTestId('catalog-types').locator('li', { hasText: 'Камера' }).first().locator('.table__link').first().click();
  // Угол и дальность читает слой камер; состояние — слой «Состояние оборудования» (#28).
  const notes = panel(page).getByTestId('catalog-attr-layer-note');
  await expect(notes.filter({ hasText: 'Камеры и зоны обзора' })).toHaveCount(2);
});

test('новый тип зоны из справочника назначается зоне в карточке и уезжает в файл', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'demo', 'before.json'));
  await expect(page.getByTestId('files-notice')).toContainText('открыт');
  await openSettings(page, 'Зоны');

  await panel(page).getByTestId('catalog-zone-label').fill('Комната охраны');
  await panel(page).getByTestId('catalog-add-zone-type').click();
  await expect(panel(page).getByTestId('catalog-error')).toHaveCount(0);
  await expect(panel(page).getByTestId('catalog-zone-types')).toContainText('Комната охраны');

  // Новый тип выбран — атрибут добавляется ему, а не типу оборудования.
  await fillAttributeKey(page, 'guardPost');
  await panel(page).getByTestId('catalog-attr-label').fill('Пост охраны');
  await panel(page).getByTestId('catalog-add-attr').click();
  await expect(panel(page).getByTestId('catalog-error')).toHaveCount(0);
  await expect(panel(page).getByTestId('catalog-attributes')).toContainText('Пост охраны');
  await closeSettings(page);

  // Зона демо-плана получает новый тип в карточке; поле атрибута появляется там же.
  // Ссылка на зону живёт в перечне — открываем его вкладку (D-249). Перечень
  // свёрнут по умолчанию и называет зону по имени, а не по id: z_back — «Служебная зона».
  await showTab(page, 'Инвентаризация');
  await expandInventoryRows(page);
  await page.getByLabel('Инвентаризация').getByRole('button', { name: 'Служебная зона', exact: true }).first().click();
  const card = await showProps(page);
  await expect(card).toHaveAttribute('data-entity-id', 'z_back');
  await card.getByLabel('Тип зоны').selectOption({ label: 'Комната охраны' });
  await expect(card).toContainText('Пост охраны');

  // Пока тип используется, удалить его нельзя. Новый тип — в конце свёрнутого списка.
  await expandCatalogZoneTypes(page);
  const row = panel(page).getByTestId('catalog-zone-types').locator('li', { hasText: 'Комната охраны' });
  await expect(row.getByRole('button', { name: 'удалить' })).toBeDisabled();
  await closeSettings(page);

  const saved = await savePlan(page);
  const added = saved.catalog.zoneTypes.find((t) => t.label === 'Комната охраны');
  expect(added?.id).toBe('zt_komnata_ohrany');
  expect(added?.attributes.map((a) => a.key)).toEqual(['guardPost']);
  expect(saved.zones.find((z) => z.id === 'z_back')?.typeId).toBe('zt_komnata_ohrany');
  expect(errors).toEqual([]);
});
