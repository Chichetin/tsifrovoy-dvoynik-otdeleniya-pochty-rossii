/**
 * UI-2Б в браузере: правая колонка — разделы, а не одна лента (D-217).
 *
 * По умолчанию все шесть разделов открыты (сценарий презентации и остальные
 * спеки этого набора этого не видят); заголовок — настоящая кнопка со
 * сводкой, сворачивает и разворачивает содержимое, не убирая его из DOM;
 * состояние живёт в localStorage; выбор объекта на плане разворачивает
 * «Свойства»; заголовки прилипают к верху колонки при прокрутке.
 */

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

test('по умолчанию все разделы открыты: aria-expanded="true", содержимое видно', async ({ page }) => {
  await openDemo(page);
  for (const title of SECTIONS) {
    const button = header(page, title);
    await expect(button).toHaveAttribute('aria-expanded', 'true');
  }
  await expect(page.getByLabel('Свойства').first()).toBeVisible();
  await expect(page.getByLabel('Ассистент')).toBeVisible();
  await expect(page.getByLabel('Проверка плана')).toBeVisible();
  await expect(page.getByLabel('Инвентаризация')).toBeVisible();
  await expect(page.getByLabel('Справочник')).toBeVisible();
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
  await expect(header(page, 'Свойства')).toHaveAttribute('aria-expanded', 'true');
});

test('выбор объекта на плане разворачивает «Свойства», если раздел был свёрнут — без рывка прокрутки страницы', async ({
  page,
}) => {
  await openDemo(page);
  await header(page, 'Свойства').click();
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
