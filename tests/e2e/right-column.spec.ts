/**
 * Боковые колонки в браузере — вкладки (D-249, заменило сворачиваемые
 * разделы D-217/D-226/D-236).
 *
 * Справа ряд «Ассистент / Площади / Проверка / Инвентаризация / Справочник»,
 * видна одна панель; слева «Библиотека / Слои». «Свойства» — не вкладка:
 * без выбора карточки нет, при выборе она стоит над вкладками, «×» снимает
 * выделение. Выбранная вкладка живёт в localStorage и переживает
 * перезагрузку, в план не попадает.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from './fixtures';
import { showTab, sideTab } from './side-tabs';

const DEMO = join(process.cwd(), 'demo', 'before.json');
const TABS_KEY = 'ops-twin.side-tabs.v1';

const RIGHT = ['Ассистент', 'Площади', 'Проверка', 'Инвентаризация', 'Справочник'] as const;

const aside = (page: Page): Locator => page.locator('aside[data-tour="side-right"]');
const propsCard = (page: Page): Locator => aside(page).getByRole('region', { name: 'Свойства' });
const closeProps = (page: Page): Locator => page.getByRole('button', { name: 'Снять выделение' });
const inventoryRows = (page: Page): Locator => page.getByLabel('Инвентаризация').locator('tbody tr');

async function openDemo(page: Page): Promise<void> {
  await page.goto('/');
  page.on('dialog', (dialog) => void dialog.accept());
  await page.getByTestId('plan-file-input').setInputFiles(DEMO);
  await expect(inventoryRows(page).first()).toBeVisible();
}

async function selectFirstObject(page: Page): Promise<void> {
  await inventoryRows(page).first().locator('.table__link').first().click();
  await expect(propsCard(page)).toBeVisible();
}

test('по умолчанию справа открыта «Инвентаризация», слева «Библиотека»; остальные панели скрыты (D-249)', async ({
  page,
}) => {
  await openDemo(page);
  await expect(page.getByRole('tablist', { name: 'Панели справа' }).getByRole('tab')).toHaveCount(RIGHT.length);
  for (const title of RIGHT) {
    await expect(sideTab(page, title)).toHaveAttribute('aria-selected', title === 'Инвентаризация' ? 'true' : 'false');
  }
  await expect(sideTab(page, 'Библиотека')).toHaveAttribute('aria-selected', 'true');
  await expect(sideTab(page, 'Слои')).toHaveAttribute('aria-selected', 'false');

  await expect(page.getByLabel('Инвентаризация')).toBeVisible();
  await expect(page.getByLabel('Библиотека оборудования')).toBeVisible();
  // `exact`: плавающая кнопка «Открыть ассистента» иначе попадает в локатор.
  await expect(page.getByLabel('Ассистент', { exact: true })).toBeHidden();
  await expect(page.getByLabel('Проверка плана')).toBeHidden();
  await expect(page.getByLabel('Справочник')).toBeHidden();
});

test('без выбора карточки «Свойства» нет вовсе — ни заголовка, ни «×» (D-249)', async ({ page }) => {
  await openDemo(page);
  await expect(propsCard(page)).toHaveCount(0);
  await expect(closeProps(page)).toHaveCount(0);
  await expect(page.getByRole('tab', { name: /^Свойства/ })).toHaveCount(0);
});

test('выбор показывает карточку над вкладками, открытая вкладка не меняется (D-249)', async ({ page }) => {
  await openDemo(page);
  await selectFirstObject(page);

  // The card scrolls on its own (capped height): measure its box, not the
  // taller section inside it.
  const card = (await aside(page).locator('.shell__props').boundingBox())!;
  const tabs = (await page.getByRole('tablist', { name: 'Панели справа' }).boundingBox())!;
  expect(card.y + card.height).toBeLessThanOrEqual(tabs.y + 1);
  await expect(sideTab(page, 'Инвентаризация')).toHaveAttribute('aria-selected', 'true');
  await expect(inventoryRows(page).first()).toBeVisible();
});

test('«×» снимает выделение, и карточка исчезает (D-249)', async ({ page }) => {
  await openDemo(page);
  await selectFirstObject(page);

  await closeProps(page).click();

  await expect(propsCard(page)).toHaveCount(0);
  await expect(page.locator('.table__row.is-selected, tr.is-selected')).toHaveCount(0);
  await expect(inventoryRows(page).first()).toBeVisible();
});

test('Escape снимает выделение так же, как «×»', async ({ page }) => {
  await openDemo(page);
  await selectFirstObject(page);

  await page.keyboard.press('Escape');

  await expect(propsCard(page)).toHaveCount(0);
});

test('выбор объекта не дёргает прокрутку страницы', async ({ page }) => {
  await openDemo(page);
  const before = await page.evaluate(() => window.scrollY);
  await selectFirstObject(page);
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
});

test('переключение вкладки: скрытая панель остаётся в DOM и сохраняет ввод', async ({ page }) => {
  await openDemo(page);
  const row = inventoryRows(page).first();

  await showTab(page, 'Площади');
  await expect(page.getByLabel('Площади').locator('tbody tr').first()).toBeVisible();
  await expect(row).toBeAttached();
  await expect(row).toBeHidden();

  await showTab(page, 'Слои');
  await showTab(page, 'Библиотека');
  const search = page.getByLabel('Поиск в библиотеке');
  await search.fill('касс');
  await showTab(page, 'Слои');
  await expect(search).toBeHidden();
  await showTab(page, 'Библиотека');
  await expect(search).toHaveValue('касс');
});

test('вкладки с клавиатуры: стрелки по кругу, Home и End, фокус идёт за выбором', async ({ page }) => {
  await openDemo(page);
  await sideTab(page, 'Инвентаризация').focus();

  await page.keyboard.press('ArrowRight');
  await expect(sideTab(page, 'Справочник')).toHaveAttribute('aria-selected', 'true');
  await expect(sideTab(page, 'Справочник')).toBeFocused();

  await page.keyboard.press('ArrowRight');
  await expect(sideTab(page, 'Ассистент')).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('ArrowLeft');
  await expect(sideTab(page, 'Справочник')).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('Home');
  await expect(sideTab(page, 'Ассистент')).toHaveAttribute('aria-selected', 'true');
  await expect(sideTab(page, 'Ассистент')).toBeFocused();

  await page.keyboard.press('End');
  await expect(sideTab(page, 'Справочник')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Справочник')).toBeVisible();
});

test('до первого щелчка по вкладке ключ в localStorage не появляется', async ({ page }) => {
  await openDemo(page);
  await expect(sideTab(page, 'Инвентаризация')).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate((key) => window.localStorage.getItem(key), TABS_KEY)).toBeNull();
});

test('выбранные вкладки живут в localStorage и переживают перезагрузку', async ({ page }) => {
  await openDemo(page);
  await showTab(page, 'Справочник');
  await showTab(page, 'Слои');

  const stored = await page.evaluate((key) => window.localStorage.getItem(key), TABS_KEY);
  expect(JSON.parse(stored!)).toEqual({ left: 'layers', right: 'catalog' });

  await page.reload();
  await expect(sideTab(page, 'Справочник')).toHaveAttribute('aria-selected', 'true');
  await expect(sideTab(page, 'Слои')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Инвентаризация')).toBeHidden();
});

test('чужое значение в localStorage не ломает колонки: открываются вкладки по умолчанию', async ({ page }) => {
  await page.addInitScript((key) => window.localStorage.setItem(key, '{"left":"nope","right":42'), TABS_KEY);
  await openDemo(page);
  await expect(sideTab(page, 'Инвентаризация')).toHaveAttribute('aria-selected', 'true');
  await expect(sideTab(page, 'Библиотека')).toHaveAttribute('aria-selected', 'true');
});

test('ряд вкладок стоит на месте, пока прокручивается открытая панель', async ({ page }) => {
  await openDemo(page);
  const list = page.getByRole('tablist', { name: 'Панели справа' });
  const before = (await list.boundingBox())!;

  await page.locator('#side-right-panel-inventory').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  expect(await page.locator('#side-right-panel-inventory').evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const after = (await list.boundingBox())!;
  expect(after.y).toBeCloseTo(before.y, 0);
  expect(await aside(page).evaluate((element) => element.scrollTop)).toBe(0);
});

test('счётчик на вкладке «Проверка» равен числу находок и красный только при severity: error', async ({ page }) => {
  const badge = () => sideTab(page, 'Проверка').locator('.side-tabs__badge');

  // Пример организаторов: находки обеих серьёзностей, есть error.
  await page.goto('/');
  page.on('dialog', (dialog) => void dialog.accept());
  await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'example_plan.json'));
  await expect(inventoryRows(page).first()).toBeVisible();
  const count = await page.getByLabel('Проверка плана').locator('.issues__item').count();
  expect(count).toBeGreaterThan(0);
  await expect(badge()).toHaveText(String(count));
  await expect(badge()).toHaveClass(/is-error/);

  // demo/after.json без находок: счётчика нет.
  await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'demo', 'after.json'));
  await expect(inventoryRows(page).first()).toBeVisible();
  await expect(page.getByLabel('Проверка плана').locator('.issues__item')).toHaveCount(0);
  await expect(badge()).toHaveCount(0);

  // Тот же план без рабочих мест: одно предупреждение правила команды, не error.
  const clean = JSON.parse(readFileSync(join(process.cwd(), 'demo', 'after.json'), 'utf8')) as {
    objects: { typeId: string }[];
  };
  clean.objects = clean.objects.filter((entry) => entry.typeId !== 'ot_workplace');
  await page.getByTestId('plan-file-input').setInputFiles({
    name: 'warning-only.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(clean)),
  });
  await expect(page.getByLabel('Проверка плана').locator('.issues__item')).toHaveCount(1);
  await expect(badge()).toHaveText('1');
  await expect(badge()).not.toHaveClass(/is-error/);
});
