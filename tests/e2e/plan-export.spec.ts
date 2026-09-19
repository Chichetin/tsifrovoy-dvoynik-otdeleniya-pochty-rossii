/**
 * U02 в браузере: «Картинка PNG» — план для согласования без скриншота
 * (находка operator №6, D-061, D-136).
 *
 * Что проверяем числами, а не глазами:
 * - скачивается настоящий PNG (сигнатура, размеры из IHDR, вес);
 * - на картинке весь план, даже если пользователь приблизил угол помещения:
 *   размер картинки тот же, что с вписанного вида;
 * - вид пользователя не изменился: масштаб, видимый кусок и выделение те же;
 * - ошибка сборки PNG видна сообщением, а не проглочена.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Download, type Locator, type Page } from '@playwright/test';

const BEFORE = join(process.cwd(), 'demo', 'before.json');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const canvas = (page: Page): Locator => page.getByTestId('editor-canvas');
const card = (page: Page): Locator => page.getByLabel('Свойства');

async function openBefore(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('plan-file-input').setInputFiles(BEFORE);
  await expect(page.getByLabel('Инвентаризация').locator('tbody tr').first()).toBeVisible();
}

/** Всё, что составляет «вид»: подпись масштаба и видимый кусок мира. */
async function viewState(page: Page): Promise<{ scale: string; visible: string }> {
  return {
    scale: (await page.getByTestId('canvas-scale').textContent()) ?? '',
    visible: (await canvas(page).getAttribute('data-visible')) ?? '',
  };
}

async function exportPng(page: Page): Promise<{ download: Download; bytes: Buffer }> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('canvas-export').click(),
  ]);
  const path = await download.path();
  return { download, bytes: await readFile(path) };
}

/** Ширина и высота из заголовка IHDR: байты 16–23, big-endian. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test.describe('«Картинка PNG» выгружает весь план', () => {
  test('демо-план: PNG с именем плана, вид и выделение не меняются', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await openBefore(page);
    // Выделенный объект: после выгрузки он должен остаться выделенным.
    await page
      .getByLabel('Инвентаризация')
      .getByRole('button', { name: 'Медиапанель у входа', exact: true })
      .first()
      .click();
    const selectedId = ((await card(page).getByTestId('props-id').textContent()) ?? '').trim();
    expect(selectedId).not.toBe('');

    const before = await viewState(page);
    const { download, bytes } = await exportPng(page);

    expect(download.suggestedFilename()).toBe('Демо-ОПС-Синтетическое-учебное-отделение.png');
    expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    expect(bytes.length).toBeGreaterThan(10 * 1024);
    const size = pngSize(bytes);
    // План 15 × 10 м с полями, не меньше 120 px/м и не больше предела 8000.
    expect(size.width).toBeGreaterThanOrEqual(1800);
    expect(size.width).toBeLessThanOrEqual(8000);
    expect(size.height).toBeGreaterThanOrEqual(1200);
    expect(size.height).toBeLessThan(size.width);

    await expect(page.getByTestId('canvas-export-notice')).toContainText('Картинка сохранена');
    await expect(page.getByTestId('canvas-export')).toBeEnabled();
    expect(await viewState(page)).toEqual(before);
    await expect(card(page).getByTestId('props-id')).toHaveText(selectedId);

    // Рамка выделения и ручки в картинку не попадают: без выделения — те же байты.
    await page.keyboard.press('Escape');
    await expect(card(page).getByTestId('props-id')).toHaveCount(0);
    const { bytes: unselected } = await exportPng(page);
    expect(unselected.equals(bytes)).toBe(true);
    expect(errors).toEqual([]);
  });

  test('приближенный угол не обрезает картинку: выгрузка та же, что со всего плана', async ({
    page,
  }) => {
    await openBefore(page);
    const fitted = await viewState(page);
    const whole = pngSize((await exportPng(page)).bytes);

    // Пользователь разглядывает угол помещения — на экране малая часть плана.
    const box = await canvas(page).boundingBox();
    await page.mouse.move((box?.x ?? 0) + 120, (box?.y ?? 0) + 120);
    for (let step = 0; step < 8; step += 1) await page.mouse.wheel(0, -240);
    const zoomed = await viewState(page);
    expect(zoomed.scale).not.toBe(fitted.scale);

    // Картинка та же по размеру, что и с вписанного вида: весь план, а не кусок.
    const { bytes } = await exportPng(page);
    expect(pngSize(bytes)).toEqual(whole);
    expect(await viewState(page)).toEqual(zoomed);
  });

  test('видимый информационный слой попадает на картинку вместе с подписью', async ({ page }) => {
    await openBefore(page);
    const { bytes: plain } = await exportPng(page);

    await page
      .getByLabel('Слои')
      .locator('.layers__item')
      .filter({ has: page.getByLabel('Имя слоя Тепловая нагрузка зон') })
      .getByRole('button', { name: 'Показывать слой Тепловая нагрузка зон' })
      .click();
    const { bytes: heat } = await exportPng(page);

    // Строка подписи «числа синтетические» добавляет высоты, заливка зон — краски.
    expect(pngSize(heat).height).toBeGreaterThan(pngSize(plain).height);
    expect(heat.equals(plain)).toBe(false);
  });

  test('ошибка сборки PNG видна сообщением, скачивания нет', async ({ page }) => {
    await openBefore(page);
    await page.evaluate(() => {
      HTMLCanvasElement.prototype.toBlob = function (callback: BlobCallback): void {
        callback(null);
      };
    });

    let downloaded = false;
    page.on('download', () => {
      downloaded = true;
    });
    await page.getByTestId('canvas-export').click();

    const notice = page.getByTestId('canvas-export-notice');
    await expect(notice).toHaveAttribute('role', 'alert');
    await expect(notice).toContainText('не удалось');
    await expect(page.getByTestId('canvas-export')).toBeEnabled();
    expect(downloaded).toBe(false);
  });
});
