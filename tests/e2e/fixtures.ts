/**
 * Общая фикстура набора e2e: обучение при первом входе (UX №2, D-195) уже
 * «пройдено» до загрузки страницы. Без неё каждая спека открывала бы
 * приложение под окном обучения, а оно модальное и забирает мышь и клавиатуру.
 * Спеки импортируют `test` и `expect` отсюда вместо `@playwright/test`.
 */

import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';
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
 * Выгрузка: JSON — кнопка «Сохранить план» (#6), картинки — меню «Экспорт»
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
  await page.getByRole('button', { name: 'Экспорт' }).click();
  await page.getByRole('menuitem', { name: new RegExp(item) }).click();
}

/**
 * Шапка больше не показывает текст статуса сохранения (D-270): `dirty` внутри
 * `FileControls` по-прежнему решает, каким предупреждением встретить «Создать
 * новый» — этим и проверяем состояние вместо снятой надписи. Работает только
 * когда в плане уже есть зоны или объекты (`hasContent`), иначе предупреждение
 * не появляется вовсе независимо от `dirty` — на пустом плане не вызывать.
 * Диалог отклоняется, планом это не двигает; снимает все слушатели `dialog`
 * перед вызовом — спека с общим `page.on('dialog', accept)` в `beforeEach`
 * иначе получила бы два ответа на один диалог. `beforeEach` ставит такой
 * слушатель заново для каждого теста, так что снятие не задевает соседние.
 */
export async function expectUnsavedEdits(page: Page, unsaved: boolean): Promise<void> {
  page.removeAllListeners('dialog');
  let message = '';
  page.once('dialog', (dialog) => {
    message = dialog.message();
    void dialog.dismiss();
  });
  await page.getByRole('button', { name: 'Создать новый' }).click();
  expect(message).toContain(
    unsaved ? 'Несохранённые правки будут потеряны.' : 'Текущий план будет заменён.',
  );
}
