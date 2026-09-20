/**
 * UI-2Б: one collapsible section of the right column.
 *
 * Wraps a panel from outside — its own markup, `aria-label` and heading are
 * untouched, this just adds a header the person can collapse. The header is a
 * real `<button>` (Enter/Space work natively, `aria-expanded` is read by a
 * screen reader) rather than `<details>/<summary>`: the header needs to stay
 * pinned to the top of the scrolling column and carry a two-part label (name
 * + live summary) that a native `<summary>` marker and default layout would
 * have to be fought with CSS to get (D-199).
 *
 * The content stays mounted and in the DOM when collapsed — `hidden`, not a
 * conditional render — so nothing this section wraps loses state, and a test
 * that already found it by its `aria-label` still finds it.
 */

import type { ReactNode } from 'react';

export type SectionProps = {
  id: string;
  title: string;
  summary: string;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
};

export function Section({ id, title, summary, collapsed, onToggle, children }: SectionProps): React.JSX.Element {
  const contentId = `right-section-${id}`;
  return (
    <div className={collapsed ? 'section is-collapsed' : 'section'}>
      <button type="button" className="section__header" aria-expanded={!collapsed} aria-controls={contentId} onClick={onToggle}>
        <svg className="section__chevron" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 6l4 4 4-4" />
        </svg>
        <span className="section__title">{title}</span>
        <span className="section__summary">{summary}</span>
      </button>
      <div id={contentId} className="section__body" hidden={collapsed}>
        {children}
      </div>
    </div>
  );
}
