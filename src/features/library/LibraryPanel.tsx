/**
 * U07: the equipment library, grouped by the catalog's own categories.
 *
 * The list is the catalog: no hard-coded names, no fixed set of groups. A type
 * added to data/catalog appears here with its size and its provenance note.
 */

import { useMemo, useState } from 'react';
import type { ObjectType } from '../../contracts/model';
import type { LibraryPanelProps } from '../../contracts/ui';
import { typeOutline } from '../../contracts/outline';
import { formatShort, NBSP } from '../../domain/number-format';

function groupByCategory(types: ObjectType[]): [string, ObjectType[]][] {
  const groups = new Map<string, ObjectType[]>();
  for (const type of types) {
    groups.set(type.category, [...(groups.get(type.category) ?? []), type]);
  }
  return [...groups.entries()];
}

export function LibraryPanel({ catalog, activeTypeId, onTool }: LibraryPanelProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [needType, setNeedType] = useState(false);

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
      {/* D-279: the armed type is drawn as a polygon instead of placed as a box. */}
      <button
        type="button"
        className="files__button library__shape"
        title="Клики по плану ставят вершины; замкнуть — клик по первой точке, Enter или двойной клик"
        onClick={() => {
          setNeedType(activeTypeId === null);
          if (activeTypeId !== null) onTool({ kind: 'shape.draw', typeId: activeTypeId });
        }}
      >
        Нарисовать свою фигуру
      </button>
      {needType && activeTypeId === null ? (
        <p className="panel__empty" role="status">
          Сначала выберите тип в списке — фигура станет объектом этого типа.
        </p>
      ) : null}
      {groups.length === 0 ? <p className="panel__empty">Ничего не найдено</p> : null}
      {groups.map(([category, types]) => (
        <div key={category} className="library__group">
          <h3 className="library__category">{category}</h3>
          <ul className="library__list">
            {types.map((type) => (
              <li key={type.id}>
                <button
                  type="button"
                  className={`library__item${activeTypeId === type.id ? ' is-selected' : ''}`}
                  aria-pressed={activeTypeId === type.id}
                  draggable
                  title={`Перетащите на план или нажмите для установки. ${type.provenance}`}
                  onDragStart={(event) => {
                    // A regular click and a native drag choose the same tool.
                    // EditorCanvas accepts only the id of that armed type.
                    event.dataTransfer.effectAllowed = 'copy';
                    event.dataTransfer.setData('text/plain', type.id);
                    onTool({ kind: 'object.place', typeId: type.id });
                  }}
                  onClick={() =>
                    onTool(
                      activeTypeId === type.id
                        ? { kind: 'select' }
                        : { kind: 'object.place', typeId: type.id },
                    )
                  }
                >
                  {typeOutline(type) === undefined ? (
                    <span className="library__swatch" style={{ background: type.color }} aria-hidden="true" />
                  ) : (
                    // A shaped type (D-277/D-279) shows its own outline: model Y is up, SVG's is down.
                    <svg
                      className="library__swatch library__swatch--shape"
                      viewBox="-0.55 -0.55 1.1 1.1"
                      aria-hidden="true"
                      data-testid={`library-shape-${type.id}`}
                    >
                      <polygon
                        points={typeOutline(type)!.map(([u, v]) => `${u},${-v}`).join(' ')}
                        fill={type.color}
                      />
                    </svg>
                  )}
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
