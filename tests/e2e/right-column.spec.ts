/**
 * Боковые колонки в браузере — вкладки (D-249, заменило сворачиваемые
 * разделы D-217/D-226/D-236).
 *
 * Справа ряд «Ассистент / Площади / Проверка / Инвентаризация», видна одна
 * панель; слева «Библиотека / Слои». Справочники — в окне «Настройки»
 * (D-350), не вкладкой. «Свойства» — не вкладка: без выбора карточки нет,
 * при выборе она встаёт в правую колонку над её вкладками (#105, было D-268),
 * левую колонку не трогает, «×» снимает выделение. Выбранная вкладка живёт
 * в localStorage и переживает перезагрузку, в план не попадает.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from './fixtures';
import { showTab, sideTab } from './side-tabs';

const DEMO = join(process.cwd(), 'demo', 'before.json');
const TABS_KEY = 'ops-twin.side-tabs.v1';

const RIGHT = ['Ассистент', 'Площади', 'Проверка', 'Инвентаризация'] as const;

const aside = (page: Page): Locator => page.locator('aside[data-tour="side-right"]');
const leftAside = (page: Page): Locator => page.locator('aside[data-tour="side-left"]');
const propsCard = (page: Page): Locator => aside(page).getByRole('region', { name: 'Свойства' });
const band = (page: Page): Locator => aside(page).locator('.shell__props-band');
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
  await expect(page.getByLabel('Ассистент', { exact: true })).toBeHidden();
  await expect(page.getByLabel('Проверка плана')).toBeHidden();
  // D-350: справочники открываются окном «Настройки», вкладки «Справочник» нет.
  await expect(page.getByRole('tab', { name: /^Справочник/ })).toHaveCount(0);
});

test('без выбора карточки «Свойства» нет вовсе — ни заголовка, ни «×» (D-249)', async ({ page }) => {
  await openDemo(page);
  await expect(propsCard(page)).toHaveCount(0);
  await expect(closeProps(page)).toHaveCount(0);
  await expect(page.getByRole('tab', { name: /^Свойства/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Свойства выбранного' })).toHaveCount(0);
});

test('выбор ставит «Свойства» над правыми вкладками; левая колонка и вкладки на месте (#105)', async ({ page }) => {
  await openDemo(page);
  await selectFirstObject(page);

  await expect(band(page)).toHaveText('Свойства');
  // D-272: подпись полосы — единственный заголовок «Свойства»; своих
  // заголовков («Свойства объекта» и т. п.) в карточке нет.
  await expect(propsCard(page).getByRole('heading')).toHaveCount(0);
  await expect(aside(page).getByRole('heading', { name: /Свойства/ })).toHaveCount(1);
  await expect(band(page).getByRole('heading', { name: 'Свойства', exact: true })).toBeVisible();
  await expect(closeProps(page)).toBeVisible();
  // Левая колонка не меняется: библиотека открыта, карточки там нет.
  await expect(page.getByLabel('Библиотека оборудования')).toBeVisible();
  await expect(sideTab(page, 'Библиотека')).toHaveAttribute('aria-selected', 'true');
  await expect(leftAside(page).getByRole('region', { name: 'Свойства' })).toHaveCount(0);
  // Справа вкладки под карточкой, открытая вкладка не сменилась.
  await expect(sideTab(page, 'Инвентаризация')).toHaveAttribute('aria-selected', 'true');
  await expect(inventoryRows(page).first()).toBeVisible();
});

test('«×» снимает выделение: карточка уходит, фокус — на открытую правую вкладку (#105)', async ({ page }) => {
  await openDemo(page);
  await selectFirstObject(page);

  await closeProps(page).click();

  await expect(propsCard(page)).toHaveCount(0);
  await expect(sideTab(page, 'Инвентаризация')).toHaveAttribute('aria-selected', 'true');
  await expect(sideTab(page, 'Инвентаризация')).toBeFocused();
  await expect(inventoryRows(page).first()).toBeVisible();
});

test('смена вкладки не снимает выделение и не прячет карточку; новый выбор показывает свою карточку (#105)', async ({
  page,
}) => {
  await openDemo(page);
  await selectFirstObject(page);
  const rows = await inventoryRows(page).count();

  await sideTab(page, 'Слои').click();
  await expect(page.getByLabel('Слои', { exact: true })).toBeVisible();
  await expect(propsCard(page)).toBeVisible();
  // Выделение осталось: Delete удаляет выбранный объект.
  await page.keyboard.press('Delete');
  await expect(inventoryRows(page)).toHaveCount(rows - 1);
  await expect(propsCard(page)).toHaveCount(0);

  // Новый выбор — карточка снова над правыми вкладками.
  await inventoryRows(page).nth(1).locator('.table__link').first().click();
  await expect(propsCard(page)).toBeVisible();
  await expect(band(page)).toHaveText('Свойства');

  await page.keyboard.press('Escape');
  await expect(propsCard(page)).toHaveCount(0);
  await expect(sideTab(page, 'Слои')).toHaveAttribute('aria-selected', 'true');
});

test('расстановка из библиотеки оставляет библиотеку и выбирает новый объект; клик по нему открывает его карточку (#105)', async ({
  page,
}) => {
  await page.goto('/');
  const canvas = page.getByTestId('editor-canvas');
  const box = (await canvas.boundingBox())!;
  const at = { x: Math.round(box.width / 2), y: Math.round(box.height / 2) };

  await page.locator('.library__item').first().click();
  await canvas.click({ position: at });
  await expect(page.getByRole('button', { name: 'Выбор', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(inventoryRows(page)).toHaveCount(1);
  await expect(page.getByLabel('Библиотека оборудования')).toBeVisible();
  await expect(sideTab(page, 'Библиотека')).toHaveAttribute('aria-selected', 'true');
  // Новый объект выбран: его карточка уже справа.
  await expect(propsCard(page)).toHaveAttribute('data-entity-id', /^eq_/);
  await expect(propsCard(page).getByLabel('Тип оборудования')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(propsCard(page)).toHaveCount(0);
  await canvas.click({ position: at });
  await expect(propsCard(page)).toBeVisible();
  await expect(propsCard(page)).toHaveAttribute('data-entity-id', /^eq_/);
  await expect(propsCard(page).getByLabel('Тип оборудования')).toBeVisible();
  await expect(page.getByLabel('Библиотека оборудования')).toBeVisible();
});

for (const size of [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
]) {
  test(`карточка объекта помещается в правую колонку без горизонтальной прокрутки, ${size.width}×${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await openDemo(page);
    const canvasBefore = (await page.getByTestId('editor-canvas').boundingBox())!;
    await selectFirstObject(page);

    const body = aside(page).locator('.shell__props-body');
    const overflow = await body.evaluate((element) => {
      const edge = element.getBoundingClientRect().right;
      const sticking = [...element.querySelectorAll('input, select, textarea, button, label, dt, dd, p, h2, h3')]
        .filter((child) => child.getBoundingClientRect().width > 0)
        .filter((child) => child.getBoundingClientRect().right > edge + 0.5)
        .map((child) => child.outerHTML.slice(0, 80));
      return { scroll: element.scrollWidth - element.clientWidth, sticking };
    });
    expect(overflow).toEqual({ scroll: 0, sticking: [] });
    // Холст не прыгает: колонка не меняет ширину, когда в ней карточка.
    const canvasAfter = (await page.getByTestId('editor-canvas').boundingBox())!;
    expect(canvasAfter).toEqual(canvasBefore);
  });
}

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

  // «Инвентаризация» — последняя: вправо по кругу на «Ассистент».
  await page.keyboard.press('ArrowRight');
  await expect(sideTab(page, 'Ассистент')).toHaveAttribute('aria-selected', 'true');
  await expect(sideTab(page, 'Ассистент')).toBeFocused();

  await page.keyboard.press('ArrowLeft');
  await expect(sideTab(page, 'Инвентаризация')).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('ArrowLeft');
  await expect(sideTab(page, 'Проверка')).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('Home');
  await expect(sideTab(page, 'Ассистент')).toHaveAttribute('aria-selected', 'true');
  await expect(sideTab(page, 'Ассистент')).toBeFocused();

  await page.keyboard.press('End');
  await expect(sideTab(page, 'Инвентаризация')).toHaveAttribute('aria-selected', 'true');
  await expect(sideTab(page, 'Инвентаризация')).toBeFocused();
  await expect(page.getByLabel('Инвентаризация')).toBeVisible();
});

test('до первого щелчка по вкладке ключ в localStorage не появляется', async ({ page }) => {
  await openDemo(page);
  await expect(sideTab(page, 'Инвентаризация')).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate((key) => window.localStorage.getItem(key), TABS_KEY)).toBeNull();
});

test('выбранные вкладки живут в localStorage и переживают перезагрузку', async ({ page }) => {
  await openDemo(page);
  await showTab(page, 'Площади');
  await showTab(page, 'Слои');

  const stored = await page.evaluate((key) => window.localStorage.getItem(key), TABS_KEY);
  expect(JSON.parse(stored!)).toEqual({ left: 'layers', right: 'metrics' });

  await page.reload();
  await expect(sideTab(page, 'Площади')).toHaveAttribute('aria-selected', 'true');
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
  // Пункты списка сгруппированы по объекту; число находок — в заголовке панели.
  const count = Number(await page.getByLabel('Проверка плана').locator('.panel__count').textContent());
  expect(count).toBeGreaterThan(0);
  await expect(badge()).toHaveText(String(count));
  await expect(badge()).toHaveClass(/is-error/);

  // demo/after.json без находок: счётчика нет.
  await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'demo', 'after.json'));
  await expect(inventoryRows(page).first()).toBeVisible();
  await expect(page.getByLabel('Проверка плана').locator('.issues__item')).toHaveCount(0);
  await expect(badge()).toHaveCount(0);

  // Тот же план без рабочих мест: одно предупреждение правила команды, не error.
  // Техника на столах уходит вместе со столами: иначе она «висит» (физика, D-286).
  const clean = JSON.parse(readFileSync(join(process.cwd(), 'demo', 'after.json'), 'utf8')) as {
    objects: { typeId: string; base_m?: number; height_m: number }[];
  };
  const desk = Math.max(...clean.objects.filter((entry) => entry.typeId === 'ot_workplace').map((entry) => entry.height_m));
  clean.objects = clean.objects.filter((entry) => entry.typeId !== 'ot_workplace' && entry.base_m !== desk);
  await page.getByTestId('plan-file-input').setInputFiles({
    name: 'warning-only.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(clean)),
  });
  await expect(page.getByLabel('Проверка плана').locator('.issues__item')).toHaveCount(1);
  await expect(badge()).toHaveText('1');
  await expect(badge()).not.toHaveClass(/is-error/);
});
