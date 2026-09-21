/**
 * U01 в браузере: открытие другого файла заново вписывает план.
 *
 * Жюри сравнивает «было → стало», открывая два файла подряд. Холст сам
 * отличает документы по `id` и имени, но `demo/before.json` и
 * `demo/after.json` несут одну личность намеренно: второй файл — это тот же
 * план после рекомендации, и повторить его в редакторе руками можно только
 * так (`tests/e2e/demo.spec.ts` это и проверяет). Значит «документ заменили»
 * должно решаться не по содержимому файла, а по самому действию открытия.
 */

import { join } from 'node:path';
import { expect, test, type Page } from './fixtures';
import { showTab } from './side-tabs';

const demo = (name: string): string => join(process.cwd(), 'demo', name);

async function open(page: Page, name: string): Promise<void> {
  await page.getByTestId('plan-file-input').setInputFiles(demo(name));
  await showTab(page, 'Инвентаризация');
  await expect(page.getByLabel('Инвентаризация').locator('tbody tr').first()).toBeVisible();
}

const scale = (page: Page) => page.getByTestId('canvas-scale');

test('второй демо-план открывается вписанным, а не в масштабе первого', async ({ page }) => {
  await page.goto('/');
  await open(page, 'before.json');
  const fitted = await scale(page).textContent();
  expect(fitted).not.toBeNull();

  // Уводим масштаб от вписанного: колесо над холстом.
  const canvas = page.getByTestId('editor-canvas');
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('холст без размеров');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let step = 0; step < 5; step += 1) await page.mouse.wheel(0, -240);
  await expect.poll(() => scale(page).textContent()).not.toBe(fitted);
  const zoomed = await scale(page).textContent();

  // Открытие второго файла — это замена документа, даже если его id и имя те
  // же: вид считается заново.
  await open(page, 'after.json');
  await expect.poll(() => scale(page).textContent()).not.toBe(zoomed);
  expect(await scale(page).textContent()).toBe(fitted);
});
