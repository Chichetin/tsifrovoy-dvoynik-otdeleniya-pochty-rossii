/** Q01: one user's change must survive a real file download and page reload. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const EXAMPLE = join(process.cwd(), 'example_plan.json');
// The hackathon Windows machine already has Chrome; no duplicate 115 MiB download.
test.use({ channel: 'chrome' });

test('готовый план → правка → файл → новая страница → те же данные', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByTestId('plan-file-input').setInputFiles(EXAMPLE);

  const inventory = page.getByLabel('Инвентаризация').locator('table').first().locator('tbody tr');
  await expect(inventory).toHaveCount(12);
  await inventory.filter({ hasText: 'Терминал электронной очереди' }).getByRole('button').first().click();

  const card = page.getByLabel('Свойства');
  await expect(card.getByTestId('props-id')).toHaveText('eq_kiosk');
  await card.getByLabel('X, м').fill('1.1');
  await card.getByLabel('Y, м').fill('2.1');
  await card.getByLabel('Поворот, °').fill('90');
  // The organizer catalog has no editable attributes for this type; a second
  // Q01 scenario covers a catalog-defined attribute. Rename this object here.
  await card.getByLabel('Название').fill('Терминал очереди Q01');
  await expect(card.getByTestId('props-zone')).toContainText('z_client');

  const download = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Сохранить' }).click(),
  ]).then(([item]) => item);
  const file = await download.path();
  expect(file).not.toBeNull();
  const before = JSON.parse(readFileSync(file as string, 'utf8'));
  expect(before.objects.find((object: { id: string }) => object.id === 'eq_kiosk')).toMatchObject({
    id: 'eq_kiosk', position: [1.1, 2.1], rotation_deg: 90,
    zoneId: 'z_client', label: 'Терминал очереди Q01',
  });
  expect(before.zones).toHaveLength(4);

  await page.reload();
  await page.getByTestId('plan-file-input').setInputFiles(file as string);
  await expect(inventory).toHaveCount(12);
  await inventory.filter({ hasText: 'Терминал очереди Q01' }).getByRole('button').first().click();
  await expect(card.getByLabel('X, м')).toHaveValue('1.1');
  await expect(card.getByLabel('Y, м')).toHaveValue('2.1');
  await expect(card.getByLabel('Поворот, °')).toHaveValue('90');
  await expect(card.getByLabel('Название')).toHaveValue('Терминал очереди Q01');

  const again = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Сохранить' }).click(),
  ]).then(([item]) => item);
  const second = await again.path();
  expect(second).not.toBeNull();
  const after = JSON.parse(readFileSync(second as string, 'utf8'));
  expect(after).toEqual(before); // IDs, geometry, catalog, attributes, layers and links.
  expect(errors).toEqual([]);
});
