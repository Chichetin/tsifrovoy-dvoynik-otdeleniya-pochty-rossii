/**
 * Общая фикстура набора e2e: обучение при первом входе (UX №2, D-195) уже
 * «пройдено» до загрузки страницы. Без неё каждая спека открывала бы
 * приложение под окном обучения, а оно модальное и забирает мышь и клавиатуру.
 * Спеки импортируют `test` и `expect` отсюда вместо `@playwright/test`.
 */

import { expect, test as base, type BrowserContext, type Dialog, type Page } from '@playwright/test';
import { ONBOARDING_KEY } from '../../src/features/onboarding/tour';

export * from '@playwright/test';

/** Ставит отметку «обучение пройдено» в каждой странице контекста до её скриптов. */
export async function skipOnboarding(context: BrowserContext): Promise<void> {
  await context.addInitScript((key) => {
    try {
      window.localStorage.setItem(key, 'done');
    } catch {
      // Хранилище недоступно — спека, которая это проверяет, сама так настроила.
    }
  }, ONBOARDING_KEY);
}

/**
 * The app opens the demo branch at start (#111). Most specs were written for the
 * empty plan a user gets on «Создать новый», so by default the first `goto('/')`
 * of a page ends with that command. A spec that works on the demo or on the
 * deployed service turns this off with `test.use({ emptyStart: false })`.
 */
async function startWithNewPlan(page: Page): Promise<void> {
  // A spec may have its own `dialog` handler; a second answer would throw.
  const answered = (page as unknown as { listenerCount(event: string): number }).listenerCount('dialog') > 0;
  const accept = (dialog: Dialog): void => void dialog.accept();
  if (!answered) page.on('dialog', accept);
  await page.getByRole('button', { name: 'Файл' }).click();
  await page.getByRole('menuitem', { name: 'Создать новый' }).click();
  await expect(page.getByRole('menu', { name: 'Файл' })).toHaveCount(0);
  // Taken off for good: the spec may add its own answer for later dialogs.
  page.off('dialog', accept);
}

export const test = base.extend<{ emptyStart: boolean }>({
  emptyStart: [true, { option: true }],
  context: async ({ context }, provide) => {
    await skipOnboarding(context);
    await provide(context);
  },
  page: async ({ page, emptyStart }, provide) => {
    if (emptyStart) {
      const goto = page.goto.bind(page);
      let first = true;
      page.goto = (async (url: string, options?: Parameters<Page['goto']>[1]) => {
        const response = await goto(url, options);
        if (first && url === '/') {
          first = false;
          await startWithNewPlan(page);
        }
        return response;
      }) as Page['goto'];
    }
    await provide(page);
  },
});

/**
 * Выгрузка: JSON — кнопка «Сохранить план» (#6), картинки — меню «Файл → Экспорт»
 * (D-255). Помощник нужен многим спекам, поэтому он здесь, а не копией в каждой.
 */
/**
 * D-286: план с нарушением физики уходит файлом только после подтверждения.
 * Вызывается между запуском ожидания скачивания и его await: окно отказа
 * встаёт ровно между нажатием и файлом.
 */
export async function confirmPhysicsBlock(page: Page): Promise<void> {
  await expect(page.getByTestId('save-blocked')).toBeVisible();
  await page.getByTestId('save-anyway').click();
}

/** То же, но окна может и не быть: план сценария не обязан нарушать физику. */
export async function passPhysicsBlock(page: Page): Promise<void> {
  const anyway = page.getByTestId('save-anyway');
  if ((await anyway.count()) > 0) await anyway.click();
}

export async function exportPlan(page: Page, item: 'JSON' | 'PNG' | 'SVG'): Promise<void> {
  if (item === 'JSON') {
    await page.getByRole('button', { name: 'Сохранить план' }).click();
    return;
  }
  await page.getByRole('button', { name: 'Файл' }).click();
  await page.getByRole('menuitem', { name: new RegExp(item) }).click();
}

/**
 * Есть ли несохранённые правки — по индикатору в шапке (`.shell__doc-state`):
 * его подсказка «Есть несохранённые правки» или «Сохранено в файл» видна при
 * любой ширине окна. Планом проверка не двигает и диалогов не открывает.
 */
export async function expectUnsavedEdits(page: Page, unsaved: boolean): Promise<void> {
  // #141: a saved plan is replaced without a question, so the dialog no longer
  // tells «saved» apart — the header indicator does, and the plan stays put.
  await expect(page.locator('.shell__doc-state')).toHaveAttribute(
    'title',
    unsaved ? 'Есть несохранённые правки' : 'Сохранено в файл',
  );
}
