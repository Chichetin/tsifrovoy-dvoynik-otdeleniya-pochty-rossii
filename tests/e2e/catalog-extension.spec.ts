/** Q01: a custom catalog type and layer survive the full browser/file cycle. */
import { readFileSync } from 'node:fs';
import { expect, test, type Page , exportPlan } from './fixtures';
import { showProps, showTab } from './side-tabs';

async function save(page: Page): Promise<string> {
  const download = await Promise.all([
    page.waitForEvent('download'),
    exportPlan(page, 'JSON'),
  ]).then(([item]) => item);
  const file = await download.path();
  if (!file) throw new Error('Скачанный файл отсутствует');
  return readFileSync(file, 'utf8');
}

test('новый тип в каталоге → атрибут и слой → повторное открытие', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const plan = JSON.parse(await save(page));
  plan.id = 'q01_synthetic_extension';
  plan.name = 'Синтетический сценарий расширения';
  plan.catalog.objectTypes.push({
    id: 'ot_q01_counter', label: 'Стойка Q01', category: 'Синтетический тип',
    defaultSize_m: [1.2, 0.6], defaultHeight_m: 1, defaultBase_m: 0,
    physical: true, occupiesFloor: true, symbol: 'rect', color: '#0B7285',
    attributes: [
      { key: 'windowNumber', label: 'Номер окна', type: 'number', required: false },
      { key: 'selfService', label: 'Самообслуживание', type: 'boolean', required: false },
    ],
    provenance: 'Синтетический тест Q01: тип добавлен только в каталог файла.',
  });
  await page.getByTestId('plan-file-input').setInputFiles({
    name: 'q01-custom.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(plan)),
  });

  await showTab(page, 'Библиотека');
  const item = page.locator('.library__item', { hasText: 'Стойка Q01' });
  await expect(item).toBeVisible();
  await item.click();
  await page.getByTestId('editor-canvas').click({ position: { x: 300, y: 260 } });
  await showTab(page, 'Инвентаризация');
  const rows = page.getByLabel('Инвентаризация').locator('table').first().locator('tbody tr');
  await expect(rows).toHaveCount(1);
  await rows.first().getByRole('button').first().click();

  const card = page.getByLabel('Свойства');
  await card.getByLabel('Номер окна').fill('4');
  await card.getByLabel('Самообслуживание').check();
  await showTab(page, 'Слои');
  await page.getByLabel('Слои').getByRole('button', { name: 'Добавить слой' }).click();
  // Вкладка «Слои» заменила карточку, выделение осталось — вернуть (D-268).
  await showProps(page);
  await card.getByLabel('Слой').selectOption({ label: 'Слой 7' });

  const before = JSON.parse(await save(page));
  expect(before.objects).toHaveLength(1);
  expect(before.objects[0]).toMatchObject({
    typeId: 'ot_q01_counter', attributes: { windowNumber: 4, selfService: true },
  });
  expect(before.objects[0].layerId).not.toBe('l_base');
  expect(before.layers.find((layer: { id: string }) => layer.id === before.objects[0].layerId)).toBeDefined();

  await page.reload();
  await page.getByTestId('plan-file-input').setInputFiles({
    name: 'q01-saved.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(before)),
  });
  await expect(rows).toHaveCount(1);
  await rows.first().getByRole('button').first().click();
  await expect(card.getByLabel('Номер окна')).toHaveValue('4');
  await expect(card.getByLabel('Самообслуживание')).toBeChecked();
  await expect(card.getByLabel('Слой')).toHaveValue(before.objects[0].layerId);
  await showTab(page, 'Библиотека');
  await expect(page.locator('.library__item', { hasText: 'Стойка Q01' })).toBeVisible();
  expect(JSON.parse(await save(page))).toEqual(before);
  expect(errors).toEqual([]);
});
