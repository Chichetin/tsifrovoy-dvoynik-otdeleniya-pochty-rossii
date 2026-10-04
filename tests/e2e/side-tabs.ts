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
  | 'Инвентаризация';

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
