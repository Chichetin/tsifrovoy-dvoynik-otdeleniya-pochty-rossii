/**
 * U02 в браузере: холст реагирует на «найди это».
 *
 * Два дефекта, которые жюри нашло руками, закрыты здесь и проверяются числами,
 * а не картинкой: открытый файл должен помещаться в холст целиком (масштаб от
 * прошлого, пустого плана прятал правую часть), а клик по находке проверки или
 * по строке перечня должен приводить взгляд к объекту, а не только выделять его
 * в карточке.
 *
 * Чем меряем: холст публикует видимый кусок мира в `data-visible`
 * («minX,minY,maxX,maxY» в метрах) и подсвеченную ссылку в `data-focus`. Это
 * те же числа, по которым он рисует, поэтому проверка не зависит от попадания
 * мышью в фигуру.
 */

import { join } from 'node:path';
import { expect, test, type Locator, type Page } from './fixtures';
import { showTab } from './side-tabs';

/** Демо-план сдачи: помещение 15 × 10 м, 53 объекта, 8 зон. */
const BEFORE = join(process.cwd(), 'demo', 'before.json');

/** Объект, который в сценарии уезжает за стену. */
const MOVED_LABEL = 'Медиапанель у входа';
const OUTSIDE: { x: number; y: number } = { x: 30, y: 20 };

type Box = { minX: number; minY: number; maxX: number; maxY: number };

const canvas = (page: Page): Locator => page.getByTestId('editor-canvas');
const card = (page: Page): Locator => page.getByLabel('Свойства');

async function openBefore(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('plan-file-input').setInputFiles(BEFORE);
  await showTab(page, 'Инвентаризация');
  await expect(page.getByLabel('Инвентаризация').locator('tbody tr').first()).toBeVisible();
}

/** Видимый кусок мира в метрах — то, что сейчас реально на экране. */
async function visibleBox(page: Page): Promise<Box> {
  const raw = await canvas(page).getAttribute('data-visible');
  expect(raw).not.toBeNull();
  const [minX, minY, maxX, maxY] = (raw as string).split(',').map(Number);
  return { minX: minX as number, minY: minY as number, maxX: maxX as number, maxY: maxY as number };
}

function holds(box: Box, x: number, y: number): boolean {
  return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
}

/** Помещение демо-плана целиком: все четыре угла его габарита. */
function holdsWholeRoom(box: Box): boolean {
  return holds(box, 0, 0) && holds(box, 15, 10);
}

async function sees(page: Page, x: number, y: number): Promise<boolean> {
  return holds(await visibleBox(page), x, y);
}

async function scale(page: Page): Promise<number> {
  const text = (await page.getByTestId('canvas-scale').textContent()) ?? '';
  return Number.parseInt(text.replace(/^.*·\s*/, ''), 10);
}

/** Выбор объекта строкой перечня: мышью по фигуре можно и промахнуться. */
async function selectByLabel(page: Page, label: string): Promise<string> {
  await page
    .getByLabel('Инвентаризация')
    .getByRole('button', { name: label, exact: true })
    .first()
    .click();
  const id = await card(page).getByTestId('props-id').textContent();
  expect(id).not.toBeNull();
  return (id as string).trim();
}

/** Утаскивает вид рукой так, чтобы найденный объект ушёл за край холста. */
async function panAway(page: Page): Promise<void> {
  const box = await canvas(page).boundingBox();
  expect(box).not.toBeNull();
  const { x, y, width, height } = box as { x: number; y: number; width: number; height: number };
  await page.getByRole('button', { name: 'Рука', exact: true }).click();
  // Три взмаха: один сдвигает вид меньше чем на половину холста, а объект после
  // перехода стоит ровно в его середине.
  for (let stroke = 0; stroke < 3; stroke += 1) {
    await page.mouse.move(x + width - 20, y + height / 2);
    await page.mouse.down();
    await page.mouse.move(x + 20, y + height / 2, { steps: 10 });
    await page.mouse.up();
  }
  await page.getByRole('button', { name: 'Выбор', exact: true }).click();
}

test.describe('холст показывает то, о чём спрашивают', () => {
  test('открытый план виден целиком, «Вписать» возвращает его после зума', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await openBefore(page);

    // Дефект жюри: масштаб оставался от пустого плана 12 × 9 и правый край
    // помещения 15 × 10 уходил за холст.
    await expect
      .poll(async () => holdsWholeRoom(await visibleBox(page)))
      .toBe(true);

    // Пользователь приблизил план колесом — вид больше не показывает всё.
    const box = await canvas(page).boundingBox();
    await page.mouse.move((box?.x ?? 0) + 200, (box?.y ?? 0) + 200);
    for (let step = 0; step < 6; step += 1) await page.mouse.wheel(0, -240);
    await expect.poll(async () => holdsWholeRoom(await visibleBox(page))).toBe(false);
    const zoomed = await scale(page);

    // Кнопка возвращает весь план…
    await page.getByTestId('canvas-fit').click();
    await expect.poll(async () => holdsWholeRoom(await visibleBox(page))).toBe(true);
    expect(await scale(page)).toBeLessThan(zoomed);

    // …и то же делает клавиша F.
    await page.mouse.move((box?.x ?? 0) + 200, (box?.y ?? 0) + 200);
    for (let step = 0; step < 6; step += 1) await page.mouse.wheel(0, -240);
    await expect.poll(async () => holdsWholeRoom(await visibleBox(page))).toBe(false);
    await page.keyboard.press('KeyF');
    await expect.poll(async () => holdsWholeRoom(await visibleBox(page))).toBe(true);

    expect(errors).toEqual([]);
  });

  test('Shift+F не сбрасывает масштаб, а нижний левый угол холста свободен', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await openBefore(page);
    const box = await canvas(page).boundingBox();
    expect(box).not.toBeNull();
    const { x, y, width, height } = box as { x: number; y: number; width: number; height: number };

    // Ревью MR !59: модификатор не проверялся, и заглавная «F» в любом месте
    // страницы молча возвращала масштаб к вписанному плану.
    await page.mouse.move(x + 200, y + 200);
    for (let step = 0; step < 6; step += 1) await page.mouse.wheel(0, -240);
    await expect.poll(async () => holdsWholeRoom(await visibleBox(page))).toBe(false);
    const zoomed = await scale(page);

    await page.keyboard.press('Shift+KeyF');
    expect(await scale(page)).toBe(zoomed);
    expect(holdsWholeRoom(await visibleBox(page))).toBe(false);

    // Голая F по-прежнему вписывает: правило сузилось, а не пропало.
    await page.keyboard.press('KeyF');
    await expect.poll(async () => holdsWholeRoom(await visibleBox(page))).toBe(true);

    // Накладки собраны в правый нижний угол, левый принадлежит плану: раньше
    // кнопка «Вписать» перехватывала здесь клики, и объект было не поставить.
    const corner = await page.evaluate(
      ([cx, cy]) => document.elementFromPoint(cx as number, cy as number)?.closest('[data-testid]')?.getAttribute('data-testid') ?? null,
      [x + 20, y + height - 20],
    );
    expect(corner).toBe('editor-canvas');

    const fit = await page.getByTestId('canvas-fit').boundingBox();
    expect(fit).not.toBeNull();
    expect((fit as { x: number }).x).toBeGreaterThan(x + width / 2);

    expect(errors).toEqual([]);
  });

  test('тачпадный свайп и средняя кнопка двигают план, колесо масштабирует', async ({ page }) => {
    await openBefore(page);
    const target = canvas(page);
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    const { x, y, width, height } = box as { x: number; y: number; width: number; height: number };
    const centre = { x: x + width / 2, y: y + height / 2 };

    const beforeSwipe = await target.getAttribute('data-visible');
    const fittedScale = await scale(page);
    await page.mouse.move(centre.x, centre.y);
    // Playwright's small pixel wheel event models a smooth two-finger swipe.
    await page.mouse.wheel(18, 16);
    await expect.poll(() => scale(page)).toBe(fittedScale);
    await expect.poll(() => target.getAttribute('data-visible')).not.toBe(beforeSwipe);

    const beforeMouseWheel = await scale(page);
    await page.mouse.wheel(0, -120);
    await expect.poll(() => scale(page)).toBeGreaterThan(beforeMouseWheel);

    const beforeCtrlWheel = await scale(page);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -60);
    await page.keyboard.up('Control');
    await expect.poll(() => scale(page)).toBeGreaterThan(beforeCtrlWheel);

    await page.getByTestId('canvas-fit').click();
    const beforeMiddleDrag = await target.getAttribute('data-visible');
    const middleScale = await scale(page);
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(centre.x + 90, centre.y + 50, { steps: 5 });
    await page.mouse.up({ button: 'middle' });
    await expect.poll(() => scale(page)).toBe(middleScale);
    await expect.poll(() => target.getAttribute('data-visible')).not.toBe(beforeMiddleDrag);
  });

  test('находка проверки и строка перечня приводят к объекту за стеной', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await openBefore(page);
    const id = await selectByLabel(page, MOVED_LABEL);

    // Уводим объект за пределы помещения числами карточки.
    await card(page).getByLabel('X, м').fill(String(OUTSIDE.x));
    await card(page).getByLabel('Y, м').fill(String(OUTSIDE.y));
    await expect(card(page).getByRole('alert')).toHaveCount(0);

    // Правка вид не двигает: объект уехал за кадр, и сам он не вернётся.
    expect(await sees(page, OUTSIDE.x, OUTSIDE.y)).toBe(false);

    // Проверка нашла его: сотрудник видит название, а стабильный `id` остаётся
    // в структурном атрибуте ссылки и не загромождает подпись (D-235).
    const finding = page
      .getByLabel('Проверка плана')
      .locator(`button[data-ref-id="${id}"]`)
      .first();
    await expect(finding).toBeVisible();
    await finding.click();

    await expect.poll(async () => sees(page, OUTSIDE.x, OUTSIDE.y)).toBe(true);
    await expect(canvas(page)).toHaveAttribute('data-focus', `object:${id}`);

    // Подсветка — подсказка, а не состояние: через пару секунд её нет.
    await expect(canvas(page)).not.toHaveAttribute('data-focus', `object:${id}`, {
      timeout: 5000,
    });

    // Уводим вид рукой и повторяем тот же путь строкой перечня.
    await panAway(page);
    expect(await sees(page, OUTSIDE.x, OUTSIDE.y)).toBe(false);

    await page
      .getByLabel('Инвентаризация')
      .getByRole('button', { name: MOVED_LABEL, exact: true })
      .first()
      .click();
    await expect.poll(async () => sees(page, OUTSIDE.x, OUTSIDE.y)).toBe(true);
    await expect(canvas(page)).toHaveAttribute('data-focus', `object:${id}`);

    // Объект, который и так виден целиком, вид не дёргает: масштаб тот же.
    const settled = await scale(page);
    await page
      .getByLabel('Инвентаризация')
      .getByRole('button', { name: MOVED_LABEL, exact: true })
      .first()
      .click();
    await expect(canvas(page)).toHaveAttribute('data-focus', `object:${id}`);
    expect(await scale(page)).toBe(settled);

    // «Вписать» после всего этого возвращает и помещение, и уехавший объект.
    await page.getByTestId('canvas-fit').click();
    await expect.poll(async () => holdsWholeRoom(await visibleBox(page))).toBe(true);
    expect(await sees(page, OUTSIDE.x, OUTSIDE.y)).toBe(true);

    expect(errors).toEqual([]);
  });
});
