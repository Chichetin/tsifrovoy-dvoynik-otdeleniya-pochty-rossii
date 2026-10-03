/**
 * #25: quick search by Ctrl+K. A combobox over one list: zones and objects
 * of the plan (by name, id, inventory number, type, zone) and commands. The
 * input keeps focus; ↑ ↓ move the active option (`aria-activedescendant`),
 * Enter runs it, Escape or a click on the backdrop closes the window. The app
 * mounts it only while open, so each opening starts with an empty query.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { PlanDocument } from '../contracts/model';
import { SEARCH_LIMIT, searchEntries, searchPlan, type SearchItem } from './quick-search';

export type QuickSearchDialogProps = {
  plan: PlanDocument;
  onClose: () => void;
  onPick: (item: SearchItem) => void;
};

export function QuickSearchDialog({ plan, onClose, onPick }: QuickSearchDialogProps): React.JSX.Element | null {
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const id = useId();
  const entries = useMemo(() => searchEntries(plan), [plan]);
  const results = useMemo(() => searchPlan(entries, query), [entries, query]);

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (item: SearchItem | undefined): void => {
    if (item === undefined) return;
    onPick(item);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (results.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((at) => (at + step + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      pick(results[active]);
    } else if (event.key === 'Tab') {
      // The window has one control; Tab must not leave it for the page behind.
      event.preventDefault();
    }
  };

  const optionId = (index: number): string => `${id}-option-${index}`;
  const empty = query.trim() === '';

  return (
    <div className="quick-search" role="presentation" onClick={onClose}>
      <div
        className="quick-search__dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Быстрый поиск"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <input
          ref={input}
          className="quick-search__input"
          type="text"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={`${id}-list`}
          aria-activedescendant={results.length > 0 ? optionId(active) : undefined}
          aria-autocomplete="list"
          aria-label="Найти объект, зону или команду"
          placeholder="Объект, инвентарный номер, id, зона или команда…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
        />
        <ul ref={list} id={`${id}-list`} className="quick-search__list" role="listbox" aria-label="Найдено">
          {results.map((item, index) => (
            <li
              key={item.key}
              id={optionId(index)}
              role="option"
              aria-selected={index === active}
              className={`quick-search__option${index === active ? ' is-active' : ''}${item.kind === 'ref' ? '' : ' is-command'}`}
              onMouseMove={() => setActive(index)}
              onClick={() => pick(item)}
            >
              <span className="quick-search__title">{item.title}</span>
              <span className="quick-search__detail">{item.detail}</span>
            </li>
          ))}
        </ul>
        <p className="quick-search__status" role="status" aria-live="polite">
          {empty
            ? 'Введите название, инвентарный номер или id. ↑ ↓ — выбор, Enter — перейти, Esc — закрыть.'
            : results.length === 0
              ? 'Ничего не найдено.'
              : `Найдено: ${results.length}${results.length === SEARCH_LIMIT ? ` (первые ${SEARCH_LIMIT})` : ''}.`}
        </p>
      </div>
    </div>
  );
}
