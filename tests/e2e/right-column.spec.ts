/**
 * UI-2Б в браузере: правая колонка — разделы, а не одна лента (D-217).
 *
 * Колонка подстраивается под выбор (D-236): без выбора открыты разделы
 * обзора, а «Свойства» свёрнуты — показывать им нечего; с выбором наоборот,
 * и заголовки свёрнутых разделов остаются на месте, открываясь одним
 * щелчком. Заголовок — настоящая кнопка со сводкой, содержимое не уходит из
 * DOM, ручной щелчок сохраняется в localStorage и переживает перезагрузку,
 * заголовки липкие при прокрутке.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from './fixtures';

const DEMO = join(process.cwd(), 'demo', 'before.json');

const SECTIONS = ['Свойства', 'Ассистент', 'Площади', 'Проверка', 'Инвентаризация', 'Справочник'] as const;

const aside = (page: Page): Locator => page.locator('aside[data-tour="side-right"]');
const header = (page: Page, title: string): Locator => aside(page).getByRole('button', { name: new RegExp(`^${title}`) });

async function openDemo(page: Page): Promise<void> {
  await page.goto('/');
  page.on('dialog', (dialog) => void dialog.accept());
  await page.getByTestId('plan-file-input').setInputFiles(DEMO);
  await expect(page.getByLabel('Инвентаризация').locator('tbody tr').first()).toBeVisible();
}

test('без выбора открыты разделы обзора, «Свойства» свёрнуты (D-236)', async ({ page }) => {
  await openDemo(page);
  for (const title of SECTIONS.filter((name) => name !== 'Свойства')) {
    await expect(header(page, title)).toHaveAttribute('aria-expanded', 'true');
  }
  // `exact`: плавающая кнопка «Открыть ассистента» (MR !197) иначе попадает
  // в тот же локатор и делает его неоднозначным.
  await expect(page.getByLabel('Ассистент', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Проверка плана')).toBeVisible();
  await expect(page.getByLabel('Инвентаризация')).toBeVisible();
  await expect(page.getByLabel('Справочник')).toBeVisible();
  // Показывать нечего — раздел свёрнут, но заголовок на месте.
  await expect(header(page, 'Свойства')).toHaveAttribute('aria-expanded', 'false');
});

test('выбор раскрывает «Свойства», обзор плана остаётся на месте (D-236)', async ({ page }) => {
  await openDemo(page);
  await page.getByLabel('Инвентаризация').locator('tbody tr').first().getByRole('button').first().click();

  await expect(header(page, 'Свойства')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('Свойства').first()).toBeVisible();
  // Обзор не прячется: поставленный объект сразу выбран (D-147), и скрытые при
  // выборе площади с перечнем были бы скрыты почти всё время работы.
  for (const title of SECTIONS.filter((name) => name !== 'Свойства')) {
    await expect(header(page, title)).toHaveAttribute('aria-expanded', 'true');
  }
  await expect(page.getByLabel('Площади').locator('tbody tr').first()).toBeVisible();
  await expect(page.getByLabel('Инвентаризация').locator('tbody tr').first()).toBeVisible();
});

test('снятие выбора снова сворачивает «Свойства» (D-236)', async ({ page }) => {
  await openDemo(page);
  await page.getByLabel('Инвентаризация').locator('tbody tr').first().getByRole('button').first().click();
  await expect(header(page, 'Свойства')).toHaveAttribute('aria-expanded', 'true');

  await page.keyboard.press('Escape');

  await expect(header(page, 'Свойства')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByLabel('Инвентаризация').locator('tbody tr').first()).toBeVisible();
});

test('щелчок по заголовку сильнее автоматики: свёрнутые вручную «Свойства» не раскрываются выбором (D-236)', async ({
  page,
}) => {
  await openDemo(page);
  await page.getByLabel('Инвентаризация').locator('tbody tr').first().getByRole('button').first().click();
  await expect(header(page, 'Свойства')).toHaveAttribute('aria-expanded', 'true');

  await header(page, 'Свойства').click();

  await expect(header(page, 'Свойства')).toHaveAttribute('aria-expanded', 'false');
  // Отметка живёт до смены выбора: другой объект снова раскрывает карточку.
  await page.getByLabel('Инвентаризация').locator('tbody tr').nth(1).getByRole('button').first().click();
  await expect(header(page, 'Свойства')).toHaveAttribute('aria-expanded', 'true');
});

test('заголовок несёт сводку, взятую из уже посчитанных данных панели', async ({ page }) => {
  await openDemo(page);

  // Инвентаризация: 53 объекта демо-плана — то же число, что в счётчике панели.
  const inventoryCount = await page.getByLabel('Инвентаризация').locator('.panel__count').first().innerText();
  await expect(header(page, 'Инвентаризация')).toContainText(`${inventoryCount} объект`);

  // Проверка: число находок в заголовке совпадает со счётчиком панели, каким бы оно ни было.
  const issueCount = await page.getByLabel('Проверка плана').locator('.panel__count').first().innerText();
  await expect(header(page, 'Проверка')).toContainText(`${issueCount} наход`);

  // Свойства: ничего не выбрано на свежеоткрытом плане.
  await expect(header(page, 'Свойства')).toContainText('ничего не выбрано');
});

test('переименование выбранного объекта сразу видно в сводке «Свойства» (D-226: индекс имён строится по документу, а не пересобирается заново кэшированным)', async ({
  page,
}) => {
  await openDemo(page);
  await page
    .getByLabel('Инвентаризация')
    .locator('tbody tr')
    .first()
    .locator('.table__link')
    .first()
    .click();

  const nameField = page.getByLabel('Свойства').first().getByLabel('Название');
  await nameField.fill('Переименованный объект D-226');
  await nameField.blur();

  await expect(header(page, 'Свойства')).toContainText('Переименованный объект D-226');
});

test('сводка «Проверка» красится в цвет ошибки только когда среди находок есть severity: error, не от одних только warning (D-226, по ревью MR !177)', async ({
  page,
}) => {
  const summary = () => header(page, 'Проверка').locator('.section__summary');

  // Пример организаторов даёт находки обеих серьёзностей сразу (геометрия —
  // error, правило команды у клиентской зоны — warning), поэтому сам по
  // себе не отличает «есть error» от «есть хоть один warning» — оба мутанта
  // на условии `severity === 'error'` красили бы сводку и здесь.
  await page.goto('/');
  page.on('dialog', (dialog) => void dialog.accept());
  await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'example_plan.json'));
  await expect(page.getByLabel('Проверка плана').locator('.issues__item.is-error').first()).toBeVisible();
  await header(page, 'Проверка').click();
  await expect(header(page, 'Проверка')).toHaveAttribute('aria-expanded', 'false');
  await expect(summary()).toHaveClass(/is-error/);

  // demo/after.json без единой находки, той же формы, что и «есть error» —
  // мутант «сравнить с 'warning'» тоже красит эту сводку неверно только на
  // третьем случае ниже, а не здесь (пустой список даёт `false` в обоих
  // прочтениях условия).
  await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'demo', 'after.json'));
  await expect(page.getByLabel('Инвентаризация').locator('tbody tr').first()).toBeVisible();
  await expect(page.getByLabel('Проверка плана').locator('.issues__item')).toHaveCount(0);
  await expect(summary()).not.toHaveClass(/is-error/);

  // Тот же чистый план без единого рабочего места в клиентской зоне: только
  // правило команды `rule_workplace_min` (team-assumption → warning),
  // геометрия не задета — ни одной находки с severity: 'error'. Красная
  // сводка здесь убивает мутанта «сравнить с 'warning'», а её отсутствие —
  // мутанта «не передавать проп вовсе».
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
  await expect(page.getByLabel('Проверка плана').locator('.issues__item.is-error')).toHaveCount(0);
  await expect(summary()).not.toHaveClass(/is-error/);
});

test('клик по заголовку сворачивает раздел: aria-expanded="false", содержимое остаётся в DOM, но скрыто', async ({
  page,
}) => {
  await openDemo(page);
  const button = header(page, 'Инвентаризация');
  const row = page.getByLabel('Инвентаризация').locator('tbody tr').first();
  await expect(row).toBeVisible();

  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  // В DOM, не размонтировано: locator продолжает находить строку, просто не видит.
  await expect(row).toBeAttached();
  await expect(row).not.toBeVisible();

  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(row).toBeVisible();
});

test('заголовок — кнопка: Enter и Space переключают раздел с клавиатуры', async ({ page }) => {
  await openDemo(page);
  const button = header(page, 'Справочник');
  await expect(button).toHaveAttribute('aria-expanded', 'true');

  await button.focus();
  await page.keyboard.press('Enter');
  await expect(button).toHaveAttribute('aria-expanded', 'false');

  await page.keyboard.press(' ');
  await expect(button).toHaveAttribute('aria-expanded', 'true');
});

test('до первого щелчка по заголовку ключ в localStorage не появляется (D-226)', async ({ page }) => {
  await openDemo(page);
  // Разделы обзора уже открыты (значит, эффект уже отработал хотя бы раз) —
  // но раз человек ещё не тронул ни один заголовок, писать в хранилище
  // нечего. Свёрнутые при этом «Свойства» — вывод из выбора (D-236), а не
  // сохранённое состояние, и в localStorage не попадают.
  for (const title of SECTIONS.filter((name) => name !== 'Свойства')) {
    await expect(header(page, title)).toHaveAttribute('aria-expanded', 'true');
  }
  const stored = await page.evaluate(() => window.localStorage.getItem('ops-twin.right-column.v1'));
  expect(stored).toBeNull();
});

test('состояние сворачивания живёт в localStorage и переживает перезагрузку', async ({ page }) => {
  await openDemo(page);
  await header(page, 'Справочник').click();
  await expect(header(page, 'Справочник')).toHaveAttribute('aria-expanded', 'false');

  const stored = await page.evaluate(() => window.localStorage.getItem('ops-twin.right-column.v1'));
  expect(stored).not.toBeNull();
  expect(JSON.parse(stored!)).toEqual({ catalog: true });

  await page.reload();
  await expect(header(page, 'Справочник')).toHaveAttribute('aria-expanded', 'false');
  // Остальные разделы не пострадали от чужой отметки.
  await expect(header(page, 'Инвентаризация')).toHaveAttribute('aria-expanded', 'true');
});

test('разворачивание раздела, свёрнутого ещё до открытия страницы, тоже сохраняется — не только сворачивание (D-226)', async ({
  page,
}) => {
  // Страница стартует с уже свёрнутым разделом (как после прошлой сессии),
  // а не с пустой записи — иначе тумблер «сравнить sections по ссылке на
  // исходное значение» и тумблер «сохранять, пока объект не пуст» ведут себя
  // одинаково и второй незаметно остаётся дырой в покрытии.
  await openDemo(page);
  await header(page, 'Справочник').click();
  await page.reload();
  await expect(header(page, 'Справочник')).toHaveAttribute('aria-expanded', 'false');

  await header(page, 'Справочник').click();
  await expect(header(page, 'Справочник')).toHaveAttribute('aria-expanded', 'true');

  const stored = await page.evaluate(() => window.localStorage.getItem('ops-twin.right-column.v1'));
  expect(stored).not.toBeNull();
  expect(JSON.parse(stored!)).toEqual({});
});

test('выбор объекта на плане разворачивает «Свойства» — без рывка прокрутки страницы', async ({
  page,
}) => {
  await openDemo(page);
  await expect(header(page, 'Свойства')).toHaveAttribute('aria-expanded', 'false');
  const pageScrollBefore = await page.evaluate(() => window.scrollY);

  await page
    .getByLabel('Инвентаризация')
    .locator('tbody tr')
    .first()
    .locator('.table__link')
    .first()
    .click();

  await expect(header(page, 'Свойства')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('Свойства').first()).toBeVisible();
  // Раскрытие раздела не двигает саму страницу — рывка нет.
  expect(await page.evaluate(() => window.scrollY)).toBe(pageScrollBefore);
});

test('заголовки разделов — липкие: остаются у верха колонки во время прокрутки', async ({ page }) => {
  await openDemo(page);
  for (const title of SECTIONS) {
    await expect(header(page, title)).toHaveCSS('position', 'sticky');
  }

  const asideBox = (await aside(page).boundingBox())!;
  const inventoryHeader = header(page, 'Инвентаризация');

  await aside(page).evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const stuckBox = (await inventoryHeader.boundingBox())!;
  // Прилипший заголовок стоит у верхней кромки колонки, а не там, куда его
  // унесла бы обычная прокрутка (он выше первого экрана содержимого).
  expect(stuckBox.y).toBeGreaterThanOrEqual(asideBox.y - 1);
  expect(stuckBox.y).toBeLessThanOrEqual(asideBox.y + stuckBox.height + 1);
});
