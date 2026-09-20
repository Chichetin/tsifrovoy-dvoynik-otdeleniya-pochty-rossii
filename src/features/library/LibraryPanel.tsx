/**
 * U07: the equipment library, grouped by the catalog's own categories.
 *
 * The list is the catalog: no hard-coded names, no fixed set of groups. A type
 * added to data/catalog appears here with its size and its provenance note.
 */

import { useMemo, useState } from 'react';
import type { ObjectType } from '../../contracts/model';
import type { LibraryPanelProps } from '../../contracts/ui';
import { formatShort, NBSP } from '../../domain/number-format';

function groupByCategory(types: ObjectType[]): [string, ObjectType[]][] {
  const groups = new Map<string, ObjectType[]>();
  for (const type of types) {
    groups.set(type.category, [...(groups.get(type.category) ?? []), type]);
  }
  return [...groups.entries()];
}

export function LibraryPanel({ catalog, onTool }: LibraryPanelProps): React.JSX.Element {
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = catalog.objectTypes.filter(
      (type) =>
        needle === '' ||
        type.label.toLowerCase().includes(needle) ||
        type.category.toLowerCase().includes(needle),
    );
    return groupByCategory(matching);
  }, [catalog.objectTypes, query]);

  return (
    <section className="panel" aria-label="Библиотека оборудования">
      <h2 className="panel__title">Библиотека</h2>
      <input
        className="panel__search"
        type="search"
        value={query}
        aria-label="Поиск в библиотеке"
        placeholder="Поиск по названию или категории"
        onChange={(event) => setQuery(event.target.value)}
      />
      {groups.length === 0 ? <p className="panel__empty">Ничего не найдено</p> : null}
      {groups.map(([category, types]) => (
        <div key={category} className="library__group">
          <h3 className="library__category">{category}</h3>
          <ul className="library__list">
            {types.map((type) => (
              <li key={type.id}>
                <button
                  type="button"
                  className="library__item"
                  title={type.provenance}
                  onClick={() => onTool({ kind: 'object.place', typeId: type.id })}
                >
                  <span className="library__swatch" style={{ background: type.color }} aria-hidden="true" />
                  <span className="library__label">{type.label}</span>
                  <span className="library__size">
                    {formatShort(type.defaultSize_m[0], 2)}×{formatShort(type.defaultSize_m[1], 2)}
                    {NBSP}м
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
