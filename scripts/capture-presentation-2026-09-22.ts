/**
 * Дополнительные снимки для PDF-презентации сдачи 22.09.2026 (1440×900).
 * Не трогает scripts/capture-presentation.ts и его 4 кадра.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { resolveChannel } from '../playwright.config';
import { skipOnboarding } from '../tests/e2e/fixtures';

const baseURL = process.env.PRESENTATION_BASE_URL ?? 'http://127.0.0.1:5401';
const dir = join(process.cwd(), 'docs', 'presentation', '2026-09-22');
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch({
  channel: resolveChannel(process.env.PW_CHANNEL),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await skipOnboarding(context);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(baseURL);
  await expect(page.getByRole('heading', { name: 'Цифровой двойник ОПС' })).toBeVisible();

  // Общий вход: демо-план before.json.
  await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'demo', 'before.json'));
  await expect(page.getByLabel('Инвентаризация').locator('table').first().locator('tbody tr')).toHaveCount(53);

  // (а) находки проверки подсвечены на плане.
  await page.getByRole('tab', { name: /^Проверка/ }).click();
  await expect(page.getByLabel('Проверка плана').locator('.issues__item')).toHaveCount(3);
  await page.screenshot({ path: join(dir, 'a-issues-on-plan.png'), animations: 'disabled' });

  // (б) «Инвентаризация» с фильтром и «Скачать CSV».
  await page.getByRole('tab', { name: /^Инвентаризация/ }).click();
  const inventory = page.getByLabel('Инвентаризация');
  await inventory.getByTestId('inventory-search').fill('ИНВ-ДЕМО-010');
  await expect(inventory.locator('table').first().locator('tbody tr')).toHaveCount(1);
  await expect(inventory.getByTestId('inventory-csv')).toBeVisible();
  await page.screenshot({ path: join(dir, 'b-inventory-filter-csv.png'), animations: 'disabled' });
  await inventory.getByTestId('inventory-search').fill('');
  await expect(inventory.locator('table').first().locator('tbody tr')).toHaveCount(53);

  // (в) информационные слои: камеры, тепло, сотрудники — «числа синтетические».
  await page.getByRole('tab', { name: /^Слои/ }).click();
  const layers = page.getByLabel('Слои');
  const item = (name: string) => layers.locator('.layers__item').filter({ has: page.getByLabel(`Имя слоя ${name}`) });
  await item('Камеры и зоны обзора').getByRole('button', { name: 'Показывать слой Камеры и зоны обзора' }).click();
  await item('Тепловая нагрузка зон').getByRole('button', { name: 'Показывать слой Тепловая нагрузка зон' }).click();
  await item('Сотрудники по зонам').getByRole('button', { name: 'Показывать слой Сотрудники по зонам' }).click();
  await expect(item('Тепловая нагрузка зон').locator('.layers__note')).toContainText('синтетические');
  await page.screenshot({ path: join(dir, 'c-info-layers.png'), animations: 'disabled' });

  // (г) «Справочник» с добавлением типа и атрибута.
  await page.getByRole('tab', { name: /^Справочник/ }).click();
  const catalog = page.getByLabel('Справочник');
  await catalog.getByTestId('catalog-toggle').click();
  await catalog.getByTestId('catalog-type-label').fill('Сейф ОПС');
  await catalog.getByTestId('catalog-add-type').click();
  await expect(catalog.getByTestId('catalog-error')).toHaveCount(0);
  await catalog.getByTestId('catalog-attr-key').fill('condition');
  await catalog.getByTestId('catalog-attr-label').fill('Состояние');
  await catalog.getByTestId('catalog-attr-default').fill('исправен');
  await catalog.getByTestId('catalog-add-attr').click();
  await expect(catalog.getByTestId('catalog-attributes')).toContainText('Состояние');
  await page.screenshot({ path: join(dir, 'd-catalog-add-type.png'), animations: 'disabled' });

  // (д) ассистент: чат-ответ без LLM, вариант на плане, кнопка «Применить».
  // Слои из шага (в) выключены заново загрузкой демо-плана: информационные
  // слои по умолчанию не показаны, и вариант ассистента виден на чистом плане.
  await page.getByTestId('plan-file-input').setInputFiles(join(process.cwd(), 'demo', 'before.json'));
  await expect(page.getByLabel('Инвентаризация').locator('table').first().locator('tbody tr')).toHaveCount(53);
  await page.getByRole('tab', { name: /^Ассистент/ }).click();
  const assistant = page.getByLabel('Ассистент', { exact: true });
  await assistant.getByLabel('Вопрос ассистенту').fill('Куда добавить рабочее место оператора?');
  await assistant.getByLabel('Вопрос ассистенту').press('Enter');
  await expect(assistant.locator('.agent__answer')).toContainText('Без LLM');
  await expect(assistant.getByRole('button', { name: /^Применить: Рабочее место оператора/ })).toBeVisible();
  await page.screenshot({ path: join(dir, 'e-assistant-chat.png'), animations: 'disabled' });

  // (е) 3D-вид.
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.getByLabel('3D-вид')).toBeVisible();
  await expect(page.getByTestId('view3d-canvas')).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(dir, 'f-view3d.png'), animations: 'disabled' });

  if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
  process.stdout.write(`Screenshots saved to ${dir}\n`);
} finally {
  await browser.close();
}
