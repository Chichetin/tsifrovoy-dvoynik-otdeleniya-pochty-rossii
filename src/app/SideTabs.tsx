/**
 * D-244: a side column's switch between its panels — WAI-ARIA tabs.
 *
 * Wraps panels from outside: their markup and `aria-label` are untouched,
 * this only adds the row of tabs and shows one panel at a time. Hidden panels
 * stay mounted (`hidden`, not a conditional render), so a typed query, a
 * filter or a scroll position survives switching away and back.
 *
 * The tab panel carries no accessible name of its own: the panel inside
 * already has one («Инвентаризация», «Проверка плана»…), and naming the
 * wrapper the same would give two landmarks with one name.
 */

import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { tabAfterKey, type TabDef } from './side-tabs';

export type TabBadge = { text: string; tone?: 'error' };

export type SideTabsProps<T extends string> = {
  /** Accessible name of the tab row, e.g. «Панели справа». */
  label: string;
  /** Prefix for element ids: two columns on one page must not collide. */
  idPrefix: string;
  tabs: readonly TabDef<T>[];
  active: T;
  onSelect: (id: T) => void;
  /** Short live counters next to a tab title, e.g. the number of findings. */
  badges?: Partial<Record<T, TabBadge>>;
  panels: Record<T, ReactNode>;
};

export function SideTabs<T extends string>({
  label,
  idPrefix,
  tabs,
  active,
  onSelect,
  badges,
  panels,
}: SideTabsProps<T>): React.JSX.Element {
  const list = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next = tabAfterKey(tabs, active, event.key);
    if (next === null) return;
    event.preventDefault();
    onSelect(next);
    // Roving focus: the newly selected tab takes focus, as the pattern expects.
    list.current?.querySelector<HTMLElement>(`#${idPrefix}-tab-${next}`)?.focus();
  };

  return (
    <div className="side-tabs">
      <div ref={list} className="side-tabs__list" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {tabs.map((tab) => {
          const selected = tab.id === active;
          const badge = badges?.[tab.id];
          return (
            <button
              key={tab.id}
              id={`${idPrefix}-tab-${tab.id}`}
              type="button"
              role="tab"
              className="side-tabs__tab"
              aria-selected={selected}
              aria-controls={`${idPrefix}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(tab.id)}
            >
              {tab.title}
              {badge === undefined ? null : ' '}
              {badge === undefined ? null : (
                <span className={badge.tone === 'error' ? 'side-tabs__badge is-error' : 'side-tabs__badge'}>
                  {badge.text}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`${idPrefix}-panel-${tab.id}`}
          className="side-tabs__panel"
          role="tabpanel"
          hidden={tab.id !== active}
        >
          {panels[tab.id]}
        </div>
      ))}
    </div>
  );
}
