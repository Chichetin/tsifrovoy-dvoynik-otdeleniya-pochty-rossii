/**
 * U07: the equipment library, grouped by the catalog's own categories.
 *
 * The list is the catalog: no hard-coded names, no fixed set of groups. A type
 * added to data/catalog appears here with its size and its provenance note.
 */

import { useMemo, useRef, useState } from 'react';
import type { ObjectType } from '../../contracts/model';
import type { LibraryPanelProps } from '../../contracts/ui';
import { typeOutline } from '../../contracts/outline';
import { PLAN_PICTOGRAM_PATHS, planPictogram } from '../../domain/plan-pictogram';
import { formatShort, NBSP } from '../../domain/number-format';

/** The same name as in `features/assistant/place-suggestion.ts`; `detail` is `{ typeId }` (#179). */
const SUGGEST_PLACE_EVENT = 'ops-twin:suggest-place';

function groupByCategory(types: ObjectType[]): [string, ObjectType[]][] {
  const groups = new Map<string, ObjectType[]>();
  for (const type of types) {
    groups.set(type.category, [...(groups.get(type.category) ?? []), type]);
  }
  return [...groups.entries()];
}

export function LibraryPanel({ catalog, activeTypeId, onTool }: LibraryPanelProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  // Which button asked for a type when none was chosen: the shape or the place (#179).
  const [needType, setNeedType] = useState<'shape' | 'place' | null>(null);
  // Roving tabindex (#146): the list is one Tab stop, arrows move inside it.
  const [rovingId, setRovingId] = useState<string | null>(null);
  const listRef = useRef<HTMLElement>(null);

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

  const visibleIds = groups.flatMap(([, types]) => types.map((type) => type.id));
  const stopId =
    rovingId !== null && visibleIds.includes(rovingId)
      ? rovingId
      : activeTypeId !== null && visibleIds.includes(activeTypeId)
        ? activeTypeId
        : (visibleIds[0] ?? null);

  const moveFocus = (event: React.KeyboardEvent, id: string): void => {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    const edge = event.key === 'Home' ? 0 : event.key === 'End' ? visibleIds.length - 1 : null;
    if (step === 0 && edge === null) return;
    event.preventDefault();
    const at = visibleIds.indexOf(id);
    const next = visibleIds[edge ?? Math.min(visibleIds.length - 1, Math.max(0, at + step))];
    if (next === undefined) return;
    setRovingId(next);
    listRef.current?.querySelector<HTMLElement>(`[data-type-id="${CSS.escape(next)}"]`)?.focus();
  };

  return (
    <section className="panel" aria-label="Библиотека оборудования" ref={listRef}>
      <h2 className="panel__title">Библиотека</h2>
      <input
        className="panel__search"
        type="search"
        value={query}
        aria-label="Поиск в библиотеке"
        placeholder="Поиск по названию или категории"
        onChange={(event) => setQuery(event.target.value)}
      />
      {/* Two actions for the chosen type, side by side, wrapping in a narrow column. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: '0.5rem' }}>
      {/* D-279: the armed type is drawn as a polygon instead of placed as a box. */}
      <button
        type="button"
        className="files__button library__shape"
        title="Клики по плану ставят вершины; замкнуть — клик по первой точке, Enter или двойной клик"
        onClick={() => {
          setNeedType(activeTypeId === null ? 'shape' : null);
          if (activeTypeId !== null) onTool({ kind: 'shape.draw', typeId: activeTypeId });
        }}
      >
        Нарисовать свою фигуру
      </button>
      {/* #179: the assistant's mode B for a new object of the chosen type. The
          type is disarmed, so a click on the plan does not place it meanwhile. */}
      <button
        type="button"
        className="files__button library__shape"
        data-testid="library-suggest-place"
        title={activeTypeId === null
          ? 'Выберите тип в списке: ассистент предложит до трёх мест для нового объекта'
          : `Ассистент предложит до трёх мест для нового объекта «${catalog.objectTypes.find((type) => type.id === activeTypeId)?.label ?? activeTypeId}»`}
        onClick={() => {
          setNeedType(activeTypeId === null ? 'place' : null);
          if (activeTypeId === null) return;
          onTool({ kind: 'select' });
          window.dispatchEvent(new CustomEvent(SUGGEST_PLACE_EVENT, { detail: { typeId: activeTypeId } }));
        }}
      >
        Предложить место
      </button>
      </div>
      {needType !== null && activeTypeId === null ? (
        <p className="panel__empty" role="status">
          {needType === 'shape'
            ? 'Сначала выберите тип в списке — фигура станет объектом этого типа.'
            : 'Сначала выберите тип в списке — ассистент предложит место для нового объекта.'}
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
                  data-type-id={type.id}
                  tabIndex={stopId === type.id ? 0 : -1}
                  onFocus={() => setRovingId(type.id)}
                  onKeyDown={(event) => moveFocus(event, type.id)}
                  draggable
                  title={`Перетащите на план или нажмите для установки. ${type.provenance}`}
                  onDragStart={(event) => {
                    // A regular click and a native drag choose the same tool.
                    // EditorCanvas accepts only the id of that armed type.
                    event.dataTransfer.effectAllowed = 'copy';
                    event.dataTransfer.setData('text/plain', type.id);
                    onTool({ kind: 'object.place', typeId: type.id });
                  }}
                  onClick={(event) =>
                    onTool(
                      // #102: the second click of a double click keeps the type;
                      // otherwise the next plan click selects the zone under it.
                      activeTypeId === type.id && event.detail < 2
                        ? { kind: 'select' }
                        : { kind: 'object.place', typeId: type.id },
                    )
                  }
                >
                  {/* Что важнее показать рядом с названием. Свой нарисованный
                      контур (D-279) — он есть только у типов, которым его
                      рисовали руками, и заменять его нечем. Иначе знак типа:
                      в списке имён полезнее «что это», чем «какой формы», —
                      тот же знак, что стоит на плане и в экспорте. Форма
                      прямоугольника, круга или треугольника остаётся образцом
                      цвета для типов без знака. */}
                  {type.outline !== undefined ? (
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
                  ) : planPictogram(type.id) !== null ? (
                    <svg
                      className="library__swatch library__swatch--icon"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      data-testid={`library-icon-${type.id}`}
                    >
                      <path
                        d={PLAN_PICTOGRAM_PATHS[planPictogram(type.id)!]}
                        fill="none"
                        stroke={type.color}
                        strokeWidth={1.8}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : typeOutline(type) === undefined ? (
                    <span className="library__swatch" style={{ background: type.color }} aria-hidden="true" />
                  ) : (
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
