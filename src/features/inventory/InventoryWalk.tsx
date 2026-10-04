/**
 * #124: the inventory walk. «Начать обход» builds a route from the entrance
 * through every object (`walkRoute` in domain). The person stands at the
 * current object and presses one mark; the mark is written into the object as
 * an ordinary edit, and the walk moves on to the next unmarked object by
 * itself. Any object of the route can become current again — picked on the
 * plan or in the route list — and its mark can be changed. «Начать заново»
 * clears every mark in one undo step. «Акт расхождений» downloads what is not
 * «на месте».
 *
 * The route and the current object are screen state of the app: the canvas
 * draws them too. The marks are plan content: saved in the file, undone with
 * Ctrl+Z.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Command } from '../../contracts/commands';
import type { Id, PlanDocument, Ref, Result } from '../../contracts/model';
import { inventoryNumberOf } from '../../domain/commands';
import {
  WALK_MARK_LABELS,
  type WalkMark,
  markObject,
  nextUnmarked,
  reconcileRoute,
  unmarkObject,
  walkActEntries,
  walkFoundNumberOf,
  walkMarkOf,
  walkRoute,
} from '../../domain/inventory';
import { walkActCsv, walkActFileName } from '../../persistence/inventory-csv';

/** `planId` ties the route to the plan it was built for: another plan drops it. */
export type WalkState = { planId: Id; route: readonly Id[]; currentId: Id | null };

/**
 * The walk of the plan as it is now, or `null` when the open plan is another
 * one. Objects added after the start join the route, deleted ones leave it; a
 * deleted current object hands over to the next unmarked one.
 */
export function walkOf(walk: WalkState | null, plan: PlanDocument): WalkState | null {
  if (walk === null || walk.planId !== plan.id) return null;
  const route = reconcileRoute(plan, walk.route);
  const currentGone = walk.currentId !== null && !plan.objects.some((object) => object.id === walk.currentId);
  if (route === walk.route && !currentGone) return walk;
  return { ...walk, route, currentId: currentGone ? nextUnmarked(plan, route, null) : walk.currentId };
}

export type InventoryWalkProps = {
  document: PlanDocument;
  /** Already passed through `walkOf` for this document. */
  walk: WalkState | null;
  onWalkChange: (walk: WalkState | null) => void;
  onCommand: (command: Command) => Result<PlanDocument>;
  onFocus: (ref: Ref) => void;
  /** Object selected on the plan: during the walk it becomes the current one. */
  selectedId: Id | null;
};

const ROW_STYLE = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.375rem', margin: '0.25rem 0' } as const;
const INPUT_STYLE = { flex: '1 1 8em', minWidth: '6em' } as const;
const ROUTE_LIST_STYLE = { maxHeight: '14em', overflowY: 'auto', margin: '0.25rem 0', paddingLeft: '2.25em' } as const;

/** Marks that take one press; «другой номер» needs the number first. */
const QUICK_MARKS: { mark: WalkMark; title: string }[] = [
  { mark: 'present', title: 'На месте' },
  { mark: 'missing', title: 'Нет' },
  { mark: 'broken', title: 'Сломан' },
];

function downloadCsv(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = window.document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function InventoryWalk({
  document: plan,
  walk,
  onWalkChange,
  onCommand,
  onFocus,
  selectedId,
}: InventoryWalkProps): React.JSX.Element {
  const [foundNumber, setFoundNumber] = useState('');
  // The number field belongs to one object: a new current object starts empty.
  const [numberFor, setNumberFor] = useState<Id | null>(walk?.currentId ?? null);
  if ((walk?.currentId ?? null) !== numberFor) {
    setNumberFor(walk?.currentId ?? null);
    setFoundNumber('');
  }
  const [error, setError] = useState<string | null>(null);
  // The route list is drawn only while open: 2000 rows cost a render on every mark.
  const [routeOpen, setRouteOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // «Начать», «Начать заново» and «Завершить» remove or move their own button;
  // focus goes to what replaces it.
  const pendingFocus = useRef<'marks' | 'start' | null>(null);
  const firstMarkRef = useRef<HTMLButtonElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (pendingFocus.current === null) return;
    (pendingFocus.current === 'marks' ? firstMarkRef : startRef).current?.focus();
    pendingFocus.current = null;
  });

  // A pick on the plan during the walk makes that object current: this is how
  // a wrong mark is found and corrected. Only a change of selection counts.
  const lastSelected = useRef<Id | null>(selectedId);
  useEffect(() => {
    if (selectedId === lastSelected.current) return;
    lastSelected.current = selectedId;
    if (walk === null || selectedId === null || selectedId === walk.currentId) return;
    if (!walk.route.includes(selectedId)) return;
    onWalkChange({ ...walk, currentId: selectedId });
  }, [selectedId, walk, onWalkChange]);

  const objects = useMemo(() => new Map(plan.objects.map((object) => [object.id, object])), [plan.objects]);
  const counts = useMemo(() => {
    const result: Record<WalkMark, number> = { present: 0, missing: 0, 'other-number': 0, broken: 0 };
    let marked = 0;
    for (const object of plan.objects) {
      const mark = walkMarkOf(object);
      if (mark === null) continue;
      result[mark] += 1;
      marked += 1;
    }
    return { byMark: result, marked };
  }, [plan.objects]);
  const total = plan.objects.length;
  const discrepancies = total - counts.byMark.present;

  const go = (route: readonly Id[], currentId: Id | null): void => {
    onWalkChange({ planId: plan.id, route, currentId });
    if (currentId !== null) onFocus({ kind: 'object', id: currentId });
  };

  // With every object marked the walk opens on the first one: the person
  // checks the marks and corrects them, or presses «Начать заново».
  const start = (): void => {
    setError(null);
    setNotice(null);
    const route = walkRoute(plan);
    go(route, nextUnmarked(plan, route, null) ?? route[0] ?? null);
    pendingFocus.current = 'marks';
  };

  const restart = (): void => {
    setError(null);
    setNotice(null);
    const commands: Command[] = plan.objects
      .filter((object) => unmarkObject(object) !== object)
      .map((object) => ({ type: 'object.put', object: unmarkObject(object) }));
    let next = plan;
    if (commands.length > 0) {
      const result = onCommand({ type: 'batch', commands });
      if (!result.ok) {
        setError(`Отметки не сброшены: ${result.issues.map((issue) => issue.message).join(' ')}`);
        return;
      }
      next = result.value;
    }
    const route = walkRoute(next);
    go(route, route[0] ?? null);
    pendingFocus.current = 'marks';
  };

  const current = walk?.currentId == null ? undefined : objects.get(walk.currentId);

  const mark = (value: WalkMark): void => {
    if (walk === null || current === undefined) return;
    const result = onCommand({ type: 'object.put', object: markObject(current, value, foundNumber) });
    if (!result.ok) {
      setError(`Отметка не записана: ${result.issues.map((issue) => issue.message).join(' ')}`);
      return;
    }
    setError(null);
    go(walk.route, nextUnmarked(result.value, walk.route, current.id));
  };

  const pick = (id: Id): void => {
    if (walk === null) return;
    setError(null);
    go(walk.route, id);
  };

  const skip = (): void => {
    if (walk === null || current === undefined) return;
    setError(null);
    go(walk.route, nextUnmarked(plan, walk.route, current.id));
  };

  const exportAct = (): void => {
    const name = walkActFileName(plan);
    const lines = walkActEntries(plan, walk?.route ?? []);
    try {
      downloadCsv(walkActCsv(plan, lines), name);
    } catch (reason) {
      setError(`Акт не выгружен: ${reason instanceof Error ? reason.message : String(reason)}`);
      return;
    }
    setError(null);
    setNotice(`Файл ${name} передан браузеру: строк ${lines.length}.`);
  };

  const position = walk === null || current === undefined ? 0 : walk.route.indexOf(current.id) + 1;
  const number = current === undefined ? null : inventoryNumberOf(current);
  const currentMark = current === undefined ? null : walkMarkOf(current);
  const zoneName =
    current?.zoneId == null ? 'вне зон' : (plan.zones.find((zone) => zone.id === current.zoneId)?.name ?? current.zoneId);
  const allMarked = total > 0 && counts.marked === total;

  return (
    <section className="panel" aria-label="Обход для инвентаризации" data-testid="inventory-walk">
      <h2 className="panel__title">
        Обход <span className="panel__count">{counts.marked} из {total}</span>
      </h2>

      {walk === null ? (
        <div style={ROW_STYLE}>
          <button ref={startRef} type="button" className="files__button" disabled={total === 0} onClick={start} data-testid="walk-start">
            {allMarked ? 'Проверить отметки' : 'Начать обход'}
          </button>
          <span className="panel__note">
            {allMarked ? 'все объекты уже отмечены' : 'маршрут от входа через все объекты'}
          </span>
        </div>
      ) : current === undefined ? (
        <p className="panel__note" data-testid="walk-done">
          Все объекты отмечены. Чтобы исправить отметку, выберите объект на плане или в маршруте.
        </p>
      ) : (
        <div data-testid="walk-current">
          <p className="panel__note">
            Объект {position} из {walk.route.length}:{' '}
            <button type="button" className="table__link" onClick={() => onFocus({ kind: 'object', id: current.id })}>
              {current.label}
            </button>{' '}
            <span className="table__muted" data-testid="walk-current-id">{current.id}</span>
            <br />
            Инв. № {number ?? '—'} · {zoneName}
            <br />
            <span data-testid="walk-current-mark">
              {currentMark === null
                ? 'Отметки нет'
                : `Отметка: ${WALK_MARK_LABELS[currentMark]}${currentMark === 'other-number' ? ` ${walkFoundNumberOf(current) ?? ''}` : ''} — можно изменить`}
            </span>
          </p>
          <div style={ROW_STYLE} role="group" aria-label="Отметка объекта">
            {QUICK_MARKS.map(({ mark: value, title }) => (
              <button
                key={value}
                ref={value === 'present' ? firstMarkRef : undefined}
                type="button"
                className="files__button"
                aria-pressed={currentMark === value}
                onClick={() => mark(value)}
                data-testid={`walk-mark-${value}`}
              >
                {title}
              </button>
            ))}
          </div>
          <div style={ROW_STYLE}>
            <input
              className="panel__search"
              style={INPUT_STYLE}
              aria-label="Номер, найденный на объекте"
              placeholder="Найденный номер"
              value={foundNumber}
              onChange={(event) => setFoundNumber(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && foundNumber.trim() !== '') mark('other-number');
              }}
              data-testid="walk-found-number"
            />
            <button
              type="button"
              className="files__button"
              disabled={foundNumber.trim() === ''}
              onClick={() => mark('other-number')}
              data-testid="walk-mark-other-number"
            >
              Другой номер
            </button>
          </div>
          <p className="panel__note">Выбор объекта на плане делает его текущим.</p>
          <div style={ROW_STYLE}>
            <button type="button" className="table__link" onClick={skip}>
              Пропустить
            </button>
          </div>
        </div>
      )}

      {walk === null ? null : (
        <details data-testid="walk-route" open={routeOpen} onToggle={(event) => setRouteOpen(event.currentTarget.open)}>
          <summary className="panel__note">Маршрут: {walk.route.length} объектов</summary>
          {!routeOpen ? null : <ol style={ROUTE_LIST_STYLE}>
            {walk.route.map((id) => {
              const object = objects.get(id);
              if (object === undefined) return null;
              const objectMark = walkMarkOf(object);
              return (
                <li key={id}>
                  <button
                    type="button"
                    className="table__link"
                    aria-current={id === walk.currentId ? 'step' : undefined}
                    onClick={() => pick(id)}
                    data-testid="walk-route-item"
                    data-object-id={id}
                  >
                    {object.label}
                  </button>{' '}
                  <span className="table__muted">{objectMark === null ? '—' : WALK_MARK_LABELS[objectMark]}</span>
                </li>
              );
            })}
          </ol>}
        </details>
      )}

      <div style={ROW_STYLE}>
        {counts.marked === 0 ? null : (
          <button type="button" className="table__link" onClick={restart} data-testid="walk-restart">
            Начать заново
          </button>
        )}
        {walk === null ? null : (
          <button
            type="button"
            className="table__link"
            onClick={() => {
              onWalkChange(null);
              pendingFocus.current = 'start';
            }}
            data-testid="walk-stop"
          >
            Завершить обход
          </button>
        )}
      </div>

      {counts.marked === 0 ? null : (
        <p className="panel__note" data-testid="walk-summary">
          {(Object.keys(WALK_MARK_LABELS) as WalkMark[])
            .filter((value) => counts.byMark[value] > 0)
            .map((value) => `${WALK_MARK_LABELS[value]}: ${counts.byMark[value]}`)
            .join(' · ')}
          {total > counts.marked ? ` · не проверено: ${total - counts.marked}` : ''}
        </p>
      )}

      <div style={ROW_STYLE}>
        <button type="button" className="files__button" disabled={total === 0} onClick={exportAct} data-testid="walk-act-csv">
          Акт расхождений (CSV)
        </button>
        <span className="panel__note">строк {discrepancies}: всё, что не «на месте»</span>
      </div>

      {notice === null ? null : <p className="panel__note" data-testid="walk-act-done">{notice}</p>}
      {error === null ? null : <p className="files__error" role="alert">{error}</p>}
    </section>
  );
}
