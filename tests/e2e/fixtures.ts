/**
 * Общая фикстура набора e2e: обучение при первом входе (UX №2, D-195) уже
 * «пройдено» до загрузки страницы. Без неё каждая спека открывала бы
 * приложение под окном обучения, а оно модальное и забирает мышь и клавиатуру.
 * Спеки импортируют `test` и `expect` отсюда вместо `@playwright/test`; само
 * обучение проверяет `onboarding.spec.ts` — он берёт голый `@playwright/test`.
 */

import { test as base, type BrowserContext, type Page } from '@playwright/test';
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

export const test = base.extend({
  context: async ({ context }, provide) => {
    await skipOnboarding(context);
    await provide(context);
  },
});

/**
 * Выгрузка через меню «Экспорт» (D-254): кнопки «Сохранить» и «Картинка» в
 * шапке больше нет, их пункты живут в одном меню. Помощник нужен многим
 * спекам, поэтому он здесь, а не копией в каждой.
 */
export async function exportPlan(page: Page, item: 'JSON' | 'PNG' | 'SVG'): Promise<void> {
  await page.getByRole('button', { name: 'Экспорт' }).click();
  await page.getByRole('menuitem', { name: new RegExp(item) }).click();
}
