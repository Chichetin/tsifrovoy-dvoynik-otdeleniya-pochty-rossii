/**
 * D-350: what is set up once per plan — name, ceiling, equipment and zone
 * types, kit rules — lives in the «Настройки» window, not in a side tab. A
 * spec that needs it opens the window on the section it needs with this
 * helper; the window is modal, so the spec closes it before touching the plan.
 */

import { expect, type Locator, type Page } from '@playwright/test';

export type SettingsSection = 'План' | 'Оборудование' | 'Зоны' | 'Правила';

export function settingsDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Настройки' });
}

/** Opens the window if it is closed and switches to the section. */
export async function openSettings(page: Page, section: SettingsSection): Promise<Locator> {
  const dialog = settingsDialog(page);
  if (!(await dialog.isVisible())) await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  const button = dialog.getByRole('navigation', { name: 'Разделы настроек' }).getByRole('button', { name: section, exact: true });
  await button.click();
  await expect(button).toHaveAttribute('aria-current', 'true');
  return dialog;
}

export async function closeSettings(page: Page): Promise<void> {
  await settingsDialog(page).getByRole('button', { name: 'Закрыть настройки' }).click();
  await expect(settingsDialog(page)).toHaveCount(0);
}
