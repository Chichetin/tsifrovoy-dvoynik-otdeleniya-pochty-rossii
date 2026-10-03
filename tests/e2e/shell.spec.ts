/**
 * UI-1А: оболочка приложения (D-196).
 *
 * Шапка — одна строка кнопок и строка статуса под ней, и её высота не зависит
 * от того, что в ней написано: ни длинная подсказка инструмента, ни кнопка
 * «Удалить перегородку» не переносят кнопки на вторую строку и не сдвигают
 * холст (находка operator №16). Проверяется на ширинах
 * от 1280 до 1536 (D-261: на 1400 шапка раньше вылезала за окно, на 1280 и
 * 1440 запас был меньше 20 px; 1460 — первая ширина с подписями истории,
 * с D-350 — 1700; с 1600 возвращаются название продукта и полное имя плана)
 * и в худшем её состоянии; в худшем состоянии свободная колонка шапки
 * не уже 20 px.
 */

import { join } from 'node:path';
import { expect, test, type Page } from './fixtures';
import { closeSettings, openSettings } from './settings';
import { showTab } from './side-tabs';

const DEMO = join(process.cwd(), 'demo', 'before.json');

type Layout = { bar: number; canvasTop: number; overflow: number; slack: number; rowTops: number[] };

/** D-261: the free header column must keep at least this much in the worst state. */
const MIN_SLACK_PX = 20;

test('границы боковых панелей двигаются, а глаз оставляет только план', async ({ page }) => {
  await page.goto('/');
  const left = page.locator('#side-panel-left');
  const right = page.locator('#side-panel-right');
  const canvas = page.locator('.shell__canvas');
  const leftWidth = (await left.boundingBox())!.width;
  const rightWidth = (await right.boundingBox())!.width;
  const canvasWidth = (await canvas.boundingBox())!.width;

  const leftHandle = page.getByRole('separator', { name: 'Изменить ширину левой панели' });
  const handleBox = (await leftHandle.boundingBox())!;
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2 + 80, handleBox.y + handleBox.height / 2, { steps: 5 });
  await page.mouse.up();
  expect((await left.boundingBox())!.width).toBeGreaterThan(leftWidth + 65);
  expect((await canvas.boundingBox())!.width).toBeLessThan(canvasWidth - 65);

  const rightHandle = page.getByRole('separator', { name: 'Изменить ширину правой панели' });
  await rightHandle.focus();
  await page.keyboard.press('ArrowLeft');
  expect((await right.boundingBox())!.width).toBeGreaterThan(rightWidth);
  await page.reload();
  expect((await left.boundingBox())!.width).toBeGreaterThan(leftWidth + 65);

  await page.getByTestId('plan-file-input').setInputFiles(DEMO);
  await expect(page.getByTestId('files-notice')).toBeVisible();
  const eye = page.getByRole('button', { name: 'Скрыть интерфейс' });
  const noticeBox = (await page.getByTestId('files-notice').boundingBox())!;
  const eyeBox = (await eye.boundingBox())!;
  expect(eyeBox.y).toBeGreaterThanOrEqual(noticeBox.y + noticeBox.height);
  const shownScale = await page.getByTestId('canvas-scale').textContent();
  const scale = async (): Promise<number> => Number(((await page.getByTestId('canvas-scale').textContent()) ?? '').match(/(\d+) px\/м/)?.[1]);
  const workingScale = await scale();
  await eye.click();
  await expect(left).toBeHidden();
  await expect(right).toBeHidden();
  await expect(page.locator('.shell__bar')).toBeHidden();
  expect((await canvas.boundingBox())!.width).toBeGreaterThan(1200);
  await expect.poll(scale).toBeGreaterThan(workingScale);
  await page.keyboard.press('Escape');
  await expect(left).toBeVisible();
  await expect(page.locator('.shell__bar')).toBeVisible();
  await expect(page.getByTestId('canvas-scale')).toHaveText(shownScale ?? '');
  await eye.click();
  await page.getByRole('button', { name: 'Показать интерфейс' }).click();
  await expect(left).toBeVisible();
  await expect(right).toBeVisible();
  await expect(page.locator('.shell__bar')).toBeVisible();
});

test('панели можно сжать до компактной ширины и открыть все вкладки', async ({ page }) => {
  await page.goto('/');
  const leftHandle = page.getByRole('separator', { name: 'Изменить ширину левой панели' });
  await leftHandle.focus();
  await page.keyboard.press('Home');
  await expect(leftHandle).toHaveAttribute('aria-valuenow', '160');
  const rightHandle = page.getByRole('separator', { name: 'Изменить ширину правой панели' });
  await rightHandle.focus();
  await page.keyboard.press('Home');
  await expect(rightHandle).toHaveAttribute('aria-valuenow', '200');
  await expect(page.locator('#side-panel-right').getByRole('tab', { name: 'Ассистент' })).toBeVisible();
  await expect(page.locator('#side-panel-right').getByRole('tab', { name: /Проверка/ })).toBeVisible();
  await page.reload();
  await expect(leftHandle).toHaveAttribute('aria-valuenow', '160');
  await expect(rightHandle).toHaveAttribute('aria-valuenow', '200');
});

test('при сужении холста готовый план вписывается, а увеличенный вид сохраняет масштаб', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('plan-file-input').setInputFiles(DEMO);
  const scale = async (): Promise<number> => {
    const label = (await page.getByTestId('canvas-scale').textContent()) ?? '';
    return Number(label.match(/(\d+) px\/м/)?.[1]);
  };
  const dragEdge = async (name: string, delta: number): Promise<void> => {
    const box = (await page.getByRole('separator', { name }).boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + delta, y, { steps: 5 });
    await page.mouse.up();
  };

  const fitted = await scale();
  await dragEdge('Изменить ширину левой панели', 80);
  await dragEdge('Изменить ширину правой панели', -60);
  expect(await scale()).toBeLessThan(fitted);

  await page.getByTestId('editor-canvas').hover({ position: { x: 300, y: 300 } });
  await page.mouse.wheel(0, -300);
  await expect.poll(scale).toBeGreaterThan(fitted);
  const zoomed = await scale();
  await dragEdge('Изменить ширину правой панели', 40);
  expect(await scale()).toBe(zoomed);
});

/**
 * Высота шапки, верх холста, вылет шапки вправо, ширина свободной колонки
 * (третья колонка сетки, minmax(0, 1fr)) и верх каждой кнопки первой строки.
 */
async function layout(page: Page): Promise<Layout> {
  return page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>('.shell__bar');
    const canvas = document.querySelector<HTMLElement>('.shell__canvas');
    if (bar === null || canvas === null) throw new Error('оболочка не смонтирована');
    const buttons = Array.from(
      bar.querySelectorAll<HTMLElement>('.toolbar > button, .shell__view button, .shell__history button, .shell__help, .files > button, .files__export > button'),
    );
    return {
      bar: Math.round(bar.getBoundingClientRect().height),
      canvasTop: Math.round(canvas.getBoundingClientRect().top),
      overflow: bar.scrollWidth - bar.clientWidth,
      slack: Number.parseFloat(getComputedStyle(bar).gridTemplateColumns.split(' ')[2] ?? 'NaN'),
      rowTops: buttons.map((button) => Math.round(button.getBoundingClientRect().top)),
    };
  });
}

async function expectOneRow(page: Page, reference: Layout, label: string): Promise<void> {
  const now = await layout(page);
  expect(now.bar, `высота шапки: ${label}`).toBe(reference.bar);
  expect(now.canvasTop, `верх холста: ${label}`).toBe(reference.canvasTop);
  expect(now.overflow, `шапка не шире окна: ${label}`).toBeLessThanOrEqual(0);
  expect(new Set(now.rowTops).size, `кнопки шапки в одну строку: ${label}`).toBe(1);
  const viewport = page.viewportSize();
  // D-260: кнопка карты горячих клавиш — в шапке, на экране, левее «Экспорт».
  const help = await page.locator('.shell__bar').getByRole('button', { name: 'Горячие клавиши', exact: true }).boundingBox();
  expect(help, `кнопка «Горячие клавиши» в шапке: ${label}`).not.toBeNull();
  const right = await page.getByRole('button', { name: 'Экспорт' }).boundingBox();
  expect(right, 'кнопка «Экспорт» на экране').not.toBeNull();
  expect(right!.x + right!.width, `«Экспорт» не обрезана: ${label}`).toBeLessThanOrEqual(viewport!.width);
  expect(help!.x + help!.width, `«Горячие клавиши» левее «Экспорт»: ${label}`).toBeLessThanOrEqual(right!.x);
}

// Different system fonts made the 1280/1460 header 13 px too wide on Linux.
// A small letter-spacing increase reproduces that width pressure on Windows.
for (const width of [1280, 1339, 1340, 1460, 1500, 1599, 1600, 1699, 1700]) {
  test(`шапка сохраняет запас при более широких надписях — ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Перегородка', exact: true }).click();
    const canvas = await page.locator('.editor-canvas canvas').first().boundingBox();
    const y = canvas!.y + canvas!.height / 2;
    await page.mouse.click(canvas!.x + canvas!.width / 2 - 60, y);
    await page.mouse.click(canvas!.x + canvas!.width / 2 + 60, y);
    await page.getByRole('button', { name: 'Выбор', exact: true }).click();
    await page.mouse.click(canvas!.x + canvas!.width / 2, y);
    await expect(page.getByText('Перегородка: тяните концы')).toBeVisible();
    await page.addStyleTag({ content: '.shell__bar button { letter-spacing: 0.4px; }' });
    const measured = await layout(page);
    expect(measured.overflow, `${width}: более широкие надписи остаются в окне`).toBeLessThanOrEqual(0);
    expect(measured.slack, `${width}: запас для отличий системных шрифтов`).toBeGreaterThanOrEqual(MIN_SLACK_PX);
    if (width === 1280 || width === 1460) {
      await page.screenshot({ path: `docs/verification/2026-09-29-header-${width}.png` });
    }
  });
}

for (const size of [
  { width: 1280, height: 800 },
  { width: 1366, height: 768 },
  { width: 1400, height: 900 },
  { width: 1440, height: 900 },
  { width: 1460, height: 900 },
  { width: 1536, height: 864 },
]) {
  test.describe(`шапка ${size.width}×${size.height}`, () => {
    test.use({ viewport: size });

    test('одна строка и постоянная высота при любом статусе, инструменте и выборе', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('.editor-canvas canvas').first()).toBeVisible();
      const reference = await layout(page);
      expect(reference.bar).toBeLessThanOrEqual(80);
      await expectOneRow(page, reference, 'новый план');

      for (const name of ['Обзор', 'Линейка', 'Помещение', 'Зона', 'Перегородка', 'Проём', 'Выбор']) {
        await page.getByRole('button', { name, exact: true }).click();
        await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
        await expectOneRow(page, reference, `инструмент «${name}»`);
      }
      await expect(page.getByRole('button', { name: 'Выбор', exact: true })).toHaveAttribute(
        'title',
        /Alt — без привязки/,
      );

      // Самая длинная кнопка шапки: «Удалить перегородку» у только что нарисованной стены.
      await page.getByRole('button', { name: 'Перегородка', exact: true }).click();
      const canvas = await page.locator('.editor-canvas canvas').first().boundingBox();
      const y = canvas!.y + canvas!.height / 2;
      await page.mouse.click(canvas!.x + canvas!.width / 2 - 60, y);
      await page.mouse.click(canvas!.x + canvas!.width / 2 + 60, y);
      await expect(page.getByRole('button', { name: 'Удалить перегородку' })).toBeVisible();
      // Подсказка правки — только под «Выбором» и у холста (D-282): вернуться
      // к «Выбору» и взять перегородку кликом по её середине.
      await page.getByRole('button', { name: 'Выбор', exact: true }).click();
      await page.mouse.click(canvas!.x + canvas!.width / 2, y);
      await expect(page.getByText('Перегородка: тяните концы')).toBeVisible();
      await expectOneRow(page, reference, 'выбрана перегородка, есть правки');
      const worst = await layout(page);
      expect(worst.slack, `запас шапки в худшем состоянии на ${size.width} px`).toBeGreaterThanOrEqual(MIN_SLACK_PX);

      // Открытый демо-план: подпись файла в строке статуса, не в строке кнопок.
      page.on('dialog', (dialog) => void dialog.accept());
      await page.getByTestId('plan-file-input').setInputFiles(DEMO);
      await expect(page.getByTestId('files-notice')).toContainText('открыт');
      await expectOneRow(page, reference, 'демо-план открыт');
    });

    test('подсказка инструмента — плашка над холстом: не в шапке и не перехватывает клики', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('.editor-canvas canvas').first()).toBeVisible();
      const reference = await layout(page);

      // Выбор типа в библиотеке включает установку — у неё своя подсказка.
      await showTab(page, 'Библиотека');
      await page.locator('.library__item').first().click();
      const note = page.getByText('Клик по плану ставит объект');
      await expect(note).toBeVisible();
      await expectOneRow(page, reference, 'установка объекта');

      const plaque = await page.locator('.toolbar__hints').boundingBox();
      const bar = await page.locator('.shell__bar').boundingBox();
      const canvas = await page.locator('.shell__canvas').boundingBox();
      expect(plaque!.y).toBeGreaterThanOrEqual(bar!.y + bar!.height);
      expect(plaque!.x).toBeGreaterThanOrEqual(canvas!.x);
      expect(plaque!.x + plaque!.width).toBeLessThanOrEqual(canvas!.x + canvas!.width);
      await expect(page.locator('.toolbar__hints')).toHaveCSS('pointer-events', 'none');
    });
  });
}

test('плашка «Правка отклонена» — вне шапки и не перехватывает клики по холсту', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.editor-canvas canvas').first()).toBeVisible();

  // Пустое название план не принимает (D-146); поле — в «Настройках» (D-350).
  await (await openSettings(page, 'План')).getByLabel('Название плана').fill('   ');
  await closeSettings(page);
  const plaque = page.locator('.shell__error');
  await expect(plaque).toHaveAttribute('role', 'alert');
  await expect(plaque).toContainText('Правка отклонена');

  const bar = await page.locator('.shell__bar').boundingBox();
  const box = await plaque.boundingBox();
  expect(box!.y, 'плашка ниже шапки, а не в ней').toBeGreaterThanOrEqual(bar!.y + bar!.height);
  await expect(plaque, 'плашка не перехватывает клики по плану под ней').toHaveCSS('pointer-events', 'none');
});

test('фокус с клавиатуры виден кольцом, мышью — нет', async ({ page }) => {
  await page.goto('/');
  const choose = page.getByRole('button', { name: 'Выбор', exact: true });
  await choose.click();
  await expect(choose).toHaveCSS('outline-style', 'none');
  await page.keyboard.press('Tab');
  const focused = page.locator(':focus');
  await expect(focused).toHaveCSS('outline-style', 'solid');
  await expect(focused).toHaveCSS('outline-width', '2px');
});

test('вторичный текст читается: контраст не ниже 4,5:1 на белом и на фоне', async ({ page }) => {
  await page.goto('/');
  const ratios = await page.evaluate(() => {
    const parse = (value: string): number[] => {
      const probe = document.createElement('span');
      probe.style.color = value;
      document.body.append(probe);
      const rgb = getComputedStyle(probe).color.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number);
      probe.remove();
      return rgb;
    };
    const luminance = (rgb: number[]): number => {
      const [r, g, b] = rgb.map((channel) => {
        const c = channel / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const contrast = (a: string, b: string): number => {
      const [x, y] = [luminance(parse(a)), luminance(parse(b))].sort((p, q) => q - p);
      return (x! + 0.05) / (y! + 0.05);
    };
    const root = getComputedStyle(document.documentElement);
    const token = (name: string): string => root.getPropertyValue(name).trim();
    return {
      mutedOnSurface: contrast(token('--color-muted'), token('--color-surface')),
      mutedOnGround: contrast(token('--color-muted'), token('--color-ground')),
      accentOnSurface: contrast(token('--color-accent'), token('--color-surface')),
      dangerOnSoft: contrast(token('--color-danger'), token('--color-danger-soft')),
      warningOnSurface: contrast(token('--color-warning'), token('--color-surface')),
    };
  });
  expect(ratios.mutedOnSurface).toBeGreaterThanOrEqual(4.5);
  expect(ratios.mutedOnGround).toBeGreaterThanOrEqual(4.5);
  expect(ratios.accentOnSurface).toBeGreaterThanOrEqual(4.5);
  expect(ratios.dangerOnSoft).toBeGreaterThanOrEqual(4.5);
  expect(ratios.warningOnSurface).toBeGreaterThanOrEqual(4.5);
  // Блоки модулей по-прежнему пишут var(--muted): алиас ведёт на тот же токен.
  const aliasColor = await page.locator('.panel__note, .panel__empty').first().evaluate((el) => getComputedStyle(el).color);
  expect(aliasColor).toBe('rgb(86, 98, 110)');
});

/**
 * D-291: три плашки живут над одним холстом — полоса сообщений о файле
 * (`.files__messages`), подсказка инструмента (`.toolbar__hints`) и отказ
 * правки (`.shell__error`). Полоса файла закрывала верхнюю строку красного
 * отказа, и прочитать его было нельзя. Проверяется не стиль, а факт: их
 * прямоугольники не пересекаются.
 */
test('плашки над холстом не наезжают друг на друга', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('plan-file-input').setInputFiles(DEMO);
  // Полоса о файле: «План … открыт».
  await expect(page.getByTestId('files-notice')).toBeVisible();

  // Отказ правки: скамья на занятое место демо-плана (физика, D-286).
  await showTab(page, 'Библиотека');
  await page.locator('.library__item', { hasText: 'Скамья / кресла для ожидания' }).first().click();
  // Поставить скамью ровно на рабочее место другого типа. Фиксированный
  // экранный пиксель меняется при ширине панелей и масштабе.
  const occupied = await page.evaluate(() => {
    type Stage = { findOne(selector: string): { getAbsolutePosition(): { x: number; y: number } } | null };
    const stage = (window as unknown as { Konva?: { stages: Stage[] } }).Konva?.stages[0];
    return stage?.findOne('.equipment-eq_13')?.getAbsolutePosition() ?? null;
  });
  expect(occupied).not.toBeNull();
  await page.getByTestId('editor-canvas').click({ position: occupied! });
  const refusal = page.locator('.shell__error');
  await expect(refusal).toContainText('занимают одно место');

  const boxes = await page.evaluate(() => {
    const rect = (selector: string): DOMRect | null => {
      const node = document.querySelector<HTMLElement>(selector);
      return node === null ? null : node.getBoundingClientRect();
    };
    return {
      strip: rect('.files__messages'),
      error: rect('.shell__error'),
      hints: rect('.toolbar__hints'),
    };
  });

  const apart = (a: DOMRect | null, b: DOMRect | null): boolean =>
    a === null || b === null || a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;

  expect(boxes.strip, 'полоса сообщений о файле видна').not.toBeNull();
  expect(boxes.error, 'отказ правки виден').not.toBeNull();
  expect(apart(boxes.strip, boxes.error), 'полоса файла не наезжает на отказ правки').toBe(true);
  expect(apart(boxes.strip, boxes.hints), 'полоса файла не наезжает на подсказку инструмента').toBe(true);
  expect(apart(boxes.error, boxes.hints), 'отказ правки не наезжает на подсказку инструмента').toBe(true);
});
