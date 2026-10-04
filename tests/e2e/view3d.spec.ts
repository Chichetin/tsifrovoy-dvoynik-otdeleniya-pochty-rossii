/**
 * D01 в браузере: 3D-вид строится из того же документа, что и 2D.
 *
 * Пиксели не читаем: секция `view3d` несёт число зон/объектов/стен сцены в
 * data-атрибутах (`data-zones-count`, `data-objects-count`, `data-walls-count`),
 * и по ним проверяется, что объект из 2D появился в 3D, а скрытый слой из него
 * исчез. Соответствие конкретных `id`/поворотов/цветов документу проверяет
 * `scene.test.ts` на чистой функции `buildScene`, без браузера. Три группы: обычный
 * запуск (canvas или честное сообщение о WebGL — что есть, то и проверяется),
 * запуск с программным WebGL (SwiftShader — canvas обязан появиться) и запуск с
 * выключенным WebGL (сообщение обязано появиться, 2D остаётся рабочим).
 */

import { readFileSync } from 'node:fs';
import {
  expect,
  test,
  type Locator,
  type Page,
  type PlaywrightWorkerArgs,
  type PlaywrightWorkerOptions,
  skipOnboarding,
} from './fixtures';
import { encodePlan } from '../../src/persistence/codec';
import { importOrganizerExample } from '../../src/persistence/organizer-import';
import { showTab } from './side-tabs';

const SWIFTSHADER_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const NO_WEBGL_ARGS = ['--disable-webgl', '--disable-3d-apis'];

type Launch = {
  playwright: PlaywrightWorkerArgs['playwright'];
  browserName: PlaywrightWorkerOptions['browserName'];
  baseURL?: string;
};

/**
 * Браузер с нужными флагами: `test.use({ launchOptions })` внутри describe
 * Playwright запрещает, поэтому запуск делается руками и закрывается всегда.
 */
async function withBrowser(
  { playwright, browserName, baseURL }: Launch,
  args: string[],
  run: (page: Page) => Promise<void>,
): Promise<void> {
  const browser = await playwright[browserName].launch({ args });
  try {
    const context = await browser.newContext(baseURL === undefined ? {} : { baseURL });
    await skipOnboarding(context);
    await run(await context.newPage());
  } finally {
    await browser.close();
  }
}

async function clickCanvas(page: Page, x: number, y: number): Promise<void> {
  await page.getByTestId('editor-canvas').click({ position: { x, y } });
}

async function placeFirstLibraryItem(page: Page, x: number, y: number): Promise<string> {
  await showTab(page, 'Библиотека');
  const item = page.locator('.library__item').first();
  const label = ((await item.locator('.library__label').textContent()) ?? '').trim();
  await item.click();
  await clickCanvas(page, x, y);
  await page.getByRole('button', { name: 'Выбор', exact: true }).click();
  return label;
}

const switchTo = (page: Page, view: '2D' | '3D') =>
  page.getByRole('group', { name: 'Вид плана' }).getByRole('button', { name: view, exact: true }).click();

/** Секция вида: число примитивов сцены живёт в её data-атрибутах, без видимого текста. */
function sceneSection(page: Page): Locator {
  return page.getByTestId('view3d');
}

/** Перечень объектов — первая таблица панели; дальше идут сводки по типам и зонам. */
const inventoryRows = (page: Page) =>
  page.getByLabel('Инвентаризация').locator('table').first().locator('tbody tr');

/**
 * Пример организаторов в нашем формате: редактор открывает только свой файл,
 * а сырой `example_plan.json` проходит через импорт (src/persistence).
 */
function examplePlanFile(): { name: string; mimeType: string; buffer: Buffer } {
  const raw: unknown = JSON.parse(readFileSync('example_plan.json', 'utf8'));
  const imported = importOrganizerExample(raw);
  if (!imported.ok) throw new Error(`example_plan.json не импортировался: ${JSON.stringify(imported.issues)}`);
  const encoded = encodePlan(imported.value);
  if (!encoded.ok) throw new Error(`план не закодировался: ${JSON.stringify(encoded.issues)}`);
  return { name: 'example_plan.ops.json', mimeType: 'application/json', buffer: Buffer.from(encoded.value) };
}

test.describe('3D-вид: обычный запуск', () => {
  test('объект из 2D виден в 3D по числу примитивов сцены; 2D остаётся доступным', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');

    await placeFirstLibraryItem(page, 320, 240);
    await switchTo(page, '3D');
    const section = sceneSection(page);
    await expect(section).toBeVisible();
    await expect(section).toHaveAttribute('data-objects-count', '1');

    // Что покажет этот браузер — canvas или сообщение о WebGL, — но что-то одно.
    const canvas = page.getByTestId('view3d-canvas');
    const unavailable = page.getByTestId('view3d-unavailable');
    await expect(canvas.or(unavailable)).toBeVisible();
    expect((await canvas.count()) + (await unavailable.count())).toBe(1);

    // Обратно в 2D: холст на месте, размещение работает, 3D больше не перекрывает.
    await switchTo(page, '2D');
    await expect(page.getByTestId('view3d')).toHaveCount(0);
    await placeFirstLibraryItem(page, 420, 300);
    await expect(inventoryRows(page)).toHaveCount(2);

    // И снова 3D: второй объект уже в сцене — состояние не хранится, сцена строится заново.
    await switchTo(page, '3D');
    await expect(section).toHaveAttribute('data-objects-count', '2');
    expect(errors).toEqual([]);
  });
});

test.describe('3D-вид: программный WebGL (SwiftShader)', () => {
  test('canvas создан; выбор из инвентаризации остаётся показан после переключения в 3D', async ({
    playwright,
    browserName,
    baseURL,
  }) => {
    await withBrowser({ playwright, browserName, baseURL }, SWIFTSHADER_ARGS, async (page) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('/');
      await placeFirstLibraryItem(page, 320, 240);

      // Выбор через строку инвентаризации: 3D показывает общий selection.
      await inventoryRows(page).first().getByRole('button').first().click();
      const selected = page.getByLabel('Свойства');
      const id = await selected.getAttribute('data-entity-id');

      await switchTo(page, '3D');
      await expect(page.getByTestId('view3d-canvas')).toBeVisible();
      await expect(page.getByTestId('view3d-unavailable')).toHaveCount(0);
      await expect(page.getByTestId('view3d-error')).toHaveCount(0);
      // Карточка «Свойства» не перерисовывается заново при смене вида: выбор общий.
      await expect(selected).toHaveAttribute('data-entity-id', id ?? '');
      expect(errors).toEqual([]);
    });
  });

  test('клик по объёму выбирает объект и открывает его карточку', async ({ playwright, browserName, baseURL }) => {
    await withBrowser({ playwright, browserName, baseURL }, SWIFTSHADER_ARGS, async (page) => {
      await page.goto('/');
      await showTab(page, 'Библиотека');
      await page.locator('.library__item').first().click();
      await page.getByTestId('editor-canvas').click();
      // Сначала выбираем фон, чтобы последующий выбор точно пришёл из 3D.
      await page.getByTestId('editor-canvas').click({ position: { x: 80, y: 120 } });
      await expect(page.getByLabel('Свойства')).toHaveAttribute('data-entity-id', 'room_main');

      await switchTo(page, '3D');
      const canvas = page.getByTestId('view3d-canvas');
      await expect(canvas).toBeVisible();
      const box = await canvas.boundingBox();
      if (box === null) throw new Error('3D canvas не измерился');
      const selected = page.getByLabel('Свойства');
      for (let offset = -80; offset <= 20; offset += 5) {
        await canvas.click({ position: { x: box.width / 2, y: box.height / 2 + offset } });
        if ((await selected.getAttribute('data-entity-id')) === 'eq_1') break;
      }

      await expect(selected).toHaveAttribute('data-entity-id', 'eq_1');
    });
  });

  test('двадцать переключений «2D / 3D» подряд: контекст жив, чёрного холста нет', async ({
    playwright,
    browserName,
    baseURL,
  }) => {
    // Двадцать сборок сцены на программном рендерере — самый долгий тест набора:
    // при двух воркерах он подходил к 30 с и падал по таймауту, а не по делу.
    test.slow();
    await withBrowser({ playwright, browserName, baseURL }, SWIFTSHADER_ARGS, async (page) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('/');
      await placeFirstLibraryItem(page, 320, 240);

      // Браузер держит считанное число контекстов (около шестнадцати) и, дойдя
      // до предела, отбирает самый старый — им может оказаться контекст сцены, и
      // холст чернеет. Здесь сторожится именно этот исход, видимый человеку.
      // Что проба не тратит контекст на каждое переключение, проверяет
      // `webgl.test.ts`: в headless-браузере выброшенные пробы собираются сборщиком
      // мусора когда придётся, и на числе переключений это не отпечатывается.
      for (let i = 0; i < 20; i += 1) {
        await switchTo(page, '3D');
        await expect(page.getByTestId('view3d-canvas')).toBeVisible();
        await switchTo(page, '2D');
      }

      await switchTo(page, '3D');
      await expect(page.getByTestId('view3d-canvas')).toBeVisible();
      await expect(page.getByTestId('view3d-context-lost')).toHaveCount(0);
      await expect(page.getByTestId('view3d-unavailable')).toHaveCount(0);
      await expect(sceneSection(page)).toHaveAttribute('data-objects-count', '1');

      // Главное: контекст последнего холста действительно живой, а не отобранный.
      const alive = await page.evaluate(() => {
        const canvas = document.querySelector('[data-testid="view3d-canvas"]');
        if (!(canvas instanceof HTMLCanvasElement)) return null;
        const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
        return gl === null ? null : !gl.isContextLost();
      });
      expect(alive).toBe(true);
      expect(errors).toEqual([]);
    });
  });

  test('демо-план организаторов: зоны и объекты примера видны в 3D', async ({ playwright, browserName, baseURL }) => {
    await withBrowser({ playwright, browserName, baseURL }, SWIFTSHADER_ARGS, async (page) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('/');
      page.once('dialog', (dialog) => void dialog.accept());
      await page.getByTestId('plan-file-input').setInputFiles(examplePlanFile());
      await expect(inventoryRows(page).first()).toBeVisible();
      const inventoryCount = await inventoryRows(page).count();

      await switchTo(page, '3D');
      await expect(page.getByTestId('view3d-canvas')).toBeVisible();
      const section = sceneSection(page);
      // Один объект — одна призма: число в сцене совпадает с инвентаризацией.
      await expect(section).toHaveAttribute('data-objects-count', String(inventoryCount));
      await expect
        .poll(async () => Number(await section.getAttribute('data-zones-count')))
        .toBeGreaterThanOrEqual(3);

      // Уход из 3D освобождает сцену: canvas удалён, ошибок в консоли нет.
      await switchTo(page, '2D');
      await expect(page.getByTestId('view3d-canvas')).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  });
});

test.describe('3D-вид: скрытые слои', () => {
  test('выключенный слой не показывается и в 3D; включили — объект вернулся', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await placeFirstLibraryItem(page, 320, 240);

    await switchTo(page, '3D');
    const section = sceneSection(page);
    await expect(section).toHaveAttribute('data-objects-count', '1');

    // «Глаз» в панели слоёв — то же действие, что прячет объект на холсте 2D.
    const eye = page.getByRole('button', { name: 'Показывать слой Основной' });
    await showTab(page, 'Слои');
    await eye.click();
    await expect(section).toHaveAttribute('data-objects-count', '0');

    await showTab(page, 'Слои');
    await eye.click();
    await expect(section).toHaveAttribute('data-objects-count', '1');
    expect(errors).toEqual([]);
  });
});

test.describe('3D-вид: потеря контекста WebGL', () => {
  test('контекст отобрали — сообщение вместо чёрного холста; вернули — сцена собрана заново', async ({
    playwright,
    browserName,
    baseURL,
  }) => {
    await withBrowser({ playwright, browserName, baseURL }, SWIFTSHADER_ARGS, async (page) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('/');
      await placeFirstLibraryItem(page, 320, 240);

      await switchTo(page, '3D');
      await expect(page.getByTestId('view3d-canvas')).toBeVisible();

      // Контекст отбирается так же, как это делает браузер: через расширение
      // WEBGL_lose_context самого холста сцены.
      const how = await page.evaluate(() => {
        const canvas = document.querySelector('[data-testid="view3d-canvas"]');
        if (!(canvas instanceof HTMLCanvasElement)) return 'нет холста';
        const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
        const lose = gl?.getExtension('WEBGL_lose_context') ?? null;
        if (lose === null) {
          canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
          return 'событие';
        }
        lose.loseContext();
        return 'расширение';
      });
      expect(['расширение', 'событие']).toContain(how);

      await expect(page.getByTestId('view3d-context-lost')).toContainText('WebGL');
      // Состав сцены — данные, а не пиксели: счётчик остаётся на месте.
      const section = sceneSection(page);
      await expect(section).toHaveAttribute('data-objects-count', '1');
      // И 2D-редактор, о котором говорит сообщение, действительно работает.
      await switchTo(page, '2D');
      await placeFirstLibraryItem(page, 420, 300);
      await expect(inventoryRows(page)).toHaveCount(2);

      // Возвращаемся в 3D: холст создаётся заново и показывает уже два объекта.
      await switchTo(page, '3D');
      await expect(page.getByTestId('view3d-canvas')).toBeVisible();
      await expect(page.getByTestId('view3d-context-lost')).toHaveCount(0);
      await expect(section).toHaveAttribute('data-objects-count', '2');

      // Контекст вернули на том же холсте — сцена пересобирается без перезагрузки.
      // Старый холст помечаем: после восстановления на его месте обязан стоять
      // новый, иначе «восстановление» — это снятая надпись над мёртвым GPU.
      const restored = await page.evaluate(() => {
        const canvas = document.querySelector('[data-testid="view3d-canvas"]');
        if (!(canvas instanceof HTMLCanvasElement)) return false;
        canvas.dataset['stale'] = 'yes';
        const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
        gl?.getExtension('WEBGL_lose_context')?.loseContext();
        canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
        return true;
      });
      expect(restored).toBe(true);
      await expect(page.getByTestId('view3d-context-lost')).toBeVisible();

      await page.evaluate(() => {
        const canvas = document.querySelector('.view3d__canvas-host canvas');
        canvas?.dispatchEvent(new Event('webglcontextrestored'));
      });
      await expect(page.getByTestId('view3d-context-lost')).toHaveCount(0);
      await expect(page.getByTestId('view3d-canvas')).toBeVisible();
      await expect(page.locator('[data-testid="view3d-canvas"][data-stale="yes"]')).toHaveCount(0);
      await expect(section).toHaveAttribute('data-objects-count', '2');
      expect(errors).toEqual([]);
    });
  });
});

test.describe('3D-вид: WebGL выключен', () => {
  test('понятное сообщение вместо пустого экрана, 2D работает', async ({ playwright, browserName, baseURL }) => {
    await withBrowser({ playwright, browserName, baseURL }, NO_WEBGL_ARGS, async (page) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('/');
      await placeFirstLibraryItem(page, 320, 240);

      await switchTo(page, '3D');
      await expect(page.getByTestId('view3d-unavailable')).toContainText('WebGL');
      await expect(page.getByTestId('view3d-canvas')).toHaveCount(0);
      // Состав сцены есть и без WebGL: она как данные строится всегда.
      await expect(sceneSection(page)).toHaveAttribute('data-objects-count', '1');

      await switchTo(page, '2D');
      await placeFirstLibraryItem(page, 420, 300);
      await expect(inventoryRows(page)).toHaveCount(2);
      expect(errors).toEqual([]);
    });
  });
});
