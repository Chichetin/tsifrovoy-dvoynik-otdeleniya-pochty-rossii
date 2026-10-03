/**
 * «Объекты по типам» и перечень объектов в «Инвентаризации», а «Типы и их
 * атрибуты» / «Типы зон и их атрибуты» / «Правила комплектования» в окне
 * «Настройки» (D-350) показывают только первые три записи, пока их не раскрыли
 * (запрос пользователя 22.09). Строки при этом остаются в DOM — скрыты
 * атрибутом `hidden`, а не удалены, — поэтому число строк в разметке не
 * меняется, только их видимость. Playwright не кликает по скрытому элементу,
 * поэтому спека, которой нужна строка за пределами первых трёх (по индексу
 * или по подписи), раскрывает список этим помощником один раз перед доступом.
 */

import { expect, type Locator, type Page } from './fixtures';
import { openSettings, type SettingsSection } from './settings';
import { showTab, type SideTabTitle } from './side-tabs';

/**
 * The toggle sits inside a right-column tab (D-249): hidden when its tab is
 * not the active one, and a click on a hidden button hangs until the test
 * timeout. Showing the tab first makes every helper below correct regardless
 * of what the caller did before it — the same guarantee `showTab` itself
 * gives, not something each call site has to remember.
 */
async function expandIfCollapsed(page: Page, tab: SideTabTitle, testId: string): Promise<void> {
  await showTab(page, tab);
  await expandButton(page.getByLabel(tab).getByTestId(testId));
}

/** The same for a catalog list in its «Настройки» section; the window stays open. */
async function expandInSettings(page: Page, section: SettingsSection, testId: string): Promise<void> {
  await expandButton((await openSettings(page, section)).getByTestId(testId));
}

async function expandButton(button: Locator): Promise<void> {
  if ((await button.count()) === 0) return;
  if ((await button.getAttribute('aria-expanded')) === 'true') return;
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
}

/** Раскрывает перечень объектов «Инвентаризации» (вторая группа панели). */
export async function expandInventoryRows(page: Page): Promise<void> {
  await expandIfCollapsed(page, 'Инвентаризация', 'inventory-rows-toggle');
}

/** Раскрывает «Объекты по типам» «Инвентаризации» (первая группа панели). */
export async function expandInventoryTypes(page: Page): Promise<void> {
  await expandIfCollapsed(page, 'Инвентаризация', 'inventory-types-toggle');
}

/** Раскрывает «Типы и их атрибуты» в «Настройках» → «Оборудование». */
export async function expandCatalogTypes(page: Page): Promise<void> {
  await expandInSettings(page, 'Оборудование', 'catalog-types-toggle');
}

/** Раскрывает «Типы зон и их атрибуты» в «Настройках» → «Зоны». */
export async function expandCatalogZoneTypes(page: Page): Promise<void> {
  await expandInSettings(page, 'Зоны', 'catalog-zone-types-toggle');
}

/** Раскрывает «Правила комплектования» в «Настройках» → «Правила». */
export async function expandCatalogRules(page: Page): Promise<void> {
  await expandInSettings(page, 'Правила', 'catalog-rules-toggle');
}
