/**
 * Справочник правится из интерфейса: специалист по инвентаризации добавляет
 * тип оборудования, атрибут и правило без правки JSON (находка operator №5).
 * Всё добавленное доходит до библиотеки, карточки, проверки и файла.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const panel = (page: Page) => page.getByLabel('Справочник');

async function savePlan(page: Page): Promise<{ catalog: { objectTypes: { id: string; label: string; attributes: { key: string }[] }[]; rules: { id: string; source: string }[] }; objects: { typeId: string; attributes: Record<string, unknown> }[] }> {
  const event = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Сохранить' }).click(),
  ]).then(([d]) => d);
  return JSON.parse(readFileSync((await event.path()) as string, 'utf8'));
}

test('новый тип, атрибут и правило из справочника доходят до библиотеки, плана и файла', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.editor-canvas canvas').first()).toBeVisible();

  await panel(page).getByTestId('catalog-toggle').click();

  // Тип: «Сейф ОПС» — появляется в списке типов и в библиотеке слева.
  await panel(page).getByTestId('catalog-type-label').fill('Сейф ОПС');
  await panel(page).getByTestId('catalog-add-type').click();
  await expect(panel(page).getByTestId('catalog-error')).toHaveCount(0);
  await expect(panel(page).getByTestId('catalog-types')).toContainText('Сейф ОПС');
  const library = page.getByLabel('Библиотека оборудования');
  await expect(library.getByRole('button', { name: /Сейф ОПС/ })).toBeVisible();

  // Атрибут у нового типа (он выбран после добавления).
  await panel(page).getByTestId('catalog-attr-key').fill('condition');
  await panel(page).getByTestId('catalog-attr-label').fill('Состояние');
  await panel(page).getByTestId('catalog-attr-default').fill('исправен');
  await panel(page).getByTestId('catalog-add-attr').click();
  await expect(panel(page).getByTestId('catalog-error')).toHaveCount(0);
  await expect(panel(page).getByTestId('catalog-attributes')).toContainText('Состояние');

  // Поставить объект нового типа на план: он в перечне, атрибут в карточке.
  await library.getByRole('button', { name: /Сейф ОПС/ }).click();
  await page.getByTestId('editor-canvas').click({ position: { x: 300, y: 260 } });
  const rows = page.getByLabel('Инвентаризация').locator('table').first().locator('tbody tr');
  await expect(rows).toHaveCount(1);
  await page.getByRole('button', { name: 'Выбор', exact: true }).click();
  await rows.first().locator('.table__link').first().click();
  await expect(page.getByLabel('Свойства')).toContainText('Состояние');

  // Теперь тип используется — удалить его из справочника нельзя.
  const typeRow = panel(page).getByTestId('catalog-types').locator('li', { hasText: 'Сейф ОПС' });
  await expect(typeRow.getByRole('button', { name: 'удалить' })).toBeDisabled();

  // Правило: в клиентской зоне не меньше двух сейфов — сразу в проверке.
  await panel(page).getByTestId('catalog-rule-zone').selectOption({ index: 1 });
  await panel(page).getByTestId('catalog-rule-object').selectOption({ label: 'Сейф ОПС' });
  await panel(page).getByTestId('catalog-rule-min').fill('2');
  await panel(page).getByTestId('catalog-add-rule').click();
  await expect(panel(page).getByTestId('catalog-error')).toHaveCount(0);
  await expect(panel(page).getByTestId('catalog-rules')).toContainText('Сейф ОПС');
  await expect(panel(page).getByTestId('catalog-rules')).toContainText('допущение команды');

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
  await panel(page).getByTestId('catalog-toggle').click();

  // Выбрать первый тип из списка и попробовать добавить обязательный атрибут.
  await panel(page).getByTestId('catalog-types').locator('li').first().locator('.table__link').first().click();
  await panel(page).getByTestId('catalog-attr-key').fill('serial');
  await panel(page).getByTestId('catalog-attr-label').fill('Серийный номер');
  await panel(page).getByTestId('catalog-attr-required').check();
  await panel(page).getByTestId('catalog-add-attr').click();

  await expect(panel(page).getByTestId('catalog-error')).toBeVisible();
  await expect(panel(page).getByTestId('catalog-attributes')).not.toContainText('Серийный номер');

  // У камеры угол и дальность обзора читает слой «Камеры и зоны обзора» — рядом с
  // атрибутом об этом сказано до клика «удалить».
  await panel(page).getByTestId('catalog-types').locator('li', { hasText: 'Камера' }).first().locator('.table__link').first().click();
  const notes = panel(page).getByTestId('catalog-attr-layer-note');
  await expect(notes).toHaveCount(2);
  await expect(notes.first()).toContainText('Камеры и зоны обзора');
});
