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

/**
 * Открывает вкладку, если она ещё не открыта, и ждёт, что она выбрана и видна.
 *
 * #222: пока выбран объект или зона, справа только карточка «Свойства», ряд
 * вкладок скрыт. Тогда помощник делает то, что сделал бы пользователь:
 * «Ассистент» открывает кнопкой на холсте (выбор остаётся для вопросов, #184),
 * другую вкладку — после «Снять выделение».
 */
export async function showTab(page: Page, title: SideTabTitle): Promise<void> {
  const tab = sideTab(page, title);
  if (!(await tab.isVisible())) {
    if (title === 'Ассистент') {
      await page.getByRole('button', { name: 'Открыть ассистента' }).click();
    } else {
      await clearSelection(page);
    }
  }
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(tab).toBeVisible();
}

/**
 * #222: the open tab of the right column, also while the card hides the tab row.
 * `getByRole` skips hidden nodes, so this one goes by the tab id.
 */
export function openRightTab(page: Page): Locator {
  return page.locator('[role="tab"][id^="side-right-tab-"][aria-selected="true"]');
}

/** #222: «×» карточки справа снимает выбор и возвращает ряд вкладок. */
export async function clearSelection(page: Page): Promise<void> {
  const close = page.locator('aside[data-tour="side-right"]').getByRole('button', { name: 'Снять выделение' });
  if ((await close.count()) === 0) return;
  await close.first().click();
  await expect(close).toHaveCount(0);
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
