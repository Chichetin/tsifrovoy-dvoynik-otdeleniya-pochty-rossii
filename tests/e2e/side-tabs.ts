/**
 * D-249: боковые колонки — вкладки, одна панель на колонку видна за раз.
 * Спека, которой нужна панель, сначала открывает её вкладку этим помощником,
 * а не ищет скрытую панель напрямую.
 */

import { expect, type Locator, type Page } from '@playwright/test';

export type SideTabTitle =
  | 'Слои'
  | 'Библиотека'
  | 'Ассистент'
  | 'Площади'
  | 'Проверка'
  | 'Инвентаризация'
  // Вкладки «Справочник» больше нет (D-350): спеки catalog-editor, right-column и assistant
  // ещё ссылаются на неё и не переписаны — до переписывания они падают.
  | 'Справочник';

/** Вкладка по названию; у «Проверки» за названием идёт счётчик находок. */
export function sideTab(page: Page, title: SideTabTitle): Locator {
  return page.getByRole('tab', { name: new RegExp(`^${title}`) });
}

/** Открывает вкладку, если она ещё не открыта, и ждёт, что она выбрана. */
export async function showTab(page: Page, title: SideTabTitle): Promise<void> {
  const tab = sideTab(page, title);
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/** #105: resize handles come only with the «Изменить форму» switch of the selected object. */
export async function enableReshape(page: Page): Promise<void> {
  await page.getByRole('checkbox', { name: 'Изменить форму' }).check();
}

/**
 * #105: the «Свойства» card of the selected object sits in the right column
 * above the tabs; there is no switch to press. Waits until it shows and returns it.
 */
export async function showProps(page: Page): Promise<Locator> {
  const card = page.locator('aside[data-tour="side-right"]').getByRole('region', { name: 'Свойства' });
  await expect(card).toBeVisible();
  return card;
}
