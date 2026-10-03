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

/**
 * D-268: после расстановки из библиотеки (или щелчка по левой вкладке)
 * выделение остаётся, а карточка «Свойства» уступает место вкладке. Кнопка
 * внизу левой колонки возвращает карточку.
 */
export async function showProps(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Свойства выбранного' }).click();
  const card = page.locator('aside[data-tour="side-left"]').getByRole('region', { name: 'Свойства' });
  await expect(card).toBeVisible();
  return card;
}
