/**
 * #124: the inventory walk. «Начать обход» builds a route from the entrance
 * through every object (`walkRoute` in domain). The person stands at the
 * current object and presses one mark; the mark is written into the object as
 * an ordinary edit, and the walk moves on to the next unmarked object by
 * itself. «Акт расхождений» downloads what is not «на месте».
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
  walkFoundNumberOf,
  walkMarkOf,
  walkRoute,
} from '../../domain/inventory';
import { walkActCsv, walkActFileName } from '../../persistence/inventory-csv';

/** `planId` ties the route to the plan it was built for: another plan drops it. */
export type WalkState = { planId: Id; route: Id[]; currentId: Id | null };

/** The walk of this plan, or `null` when the open plan is another one. */
export function walkOf(walk: WalkState | null, plan: PlanDocument): WalkState | null {
  return walk !== null && walk.planId === plan.id ? walk : null;
}

export type InventoryWalkProps = {
  document: PlanDocument;
  walk: WalkState | null;
  onWalkChange: (walk: WalkState | null) => void;
  onCommand: (command: Command) => Result<PlanDocument>;
  onFocus: (ref: Ref) => void;
};

const ROW_STYLE = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.375rem', margin: '0.25rem 0' } as const;
const INPUT_STYLE = { flex: '1 1 8em', minWidth: '6em' } as const;

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

export function InventoryWalk({ document: plan, walk: anyWalk, onWalkChange, onCommand, onFocus }: InventoryWalkProps): React.JSX.Element {
  const [foundNumber, setFoundNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // «Начать» and «Завершить» remove their own button; focus goes to what replaces it.
  const pendingFocus = useRef<'marks' | 'start' | null>(null);
  const firstMarkRef = useRef<HTMLButtonElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (pendingFocus.current === null) return;
    (pendingFocus.current === 'marks' ? firstMarkRef : startRef).current?.focus();
    pendingFocus.current = null;
  });

  // Another plan — another route: ids of the old one mean nothing here.
  const walk = walkOf(anyWalk, plan);

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

  const go = (route: Id[], currentId: Id | null): void => {
    onWalkChange({ planId: plan.id, route, currentId });
    setFoundNumber('');
    if (currentId !== null) onFocus({ kind: 'object', id: currentId });
  };

  const start = (): void => {
    setError(null);
    setNotice(null);
    const route = walkRoute(plan);
    go(route, nextUnmarked(plan, route, null));
    pendingFocus.current = 'marks';
  };

  const current = walk?.currentId == null ? undefined : plan.objects.find((object) => object.id === walk.currentId);

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

  const skip = (): void => {
    if (walk === null || current === undefined) return;
    setError(null);
    go(walk.route, nextUnmarked(plan, walk.route, current.id));
  };

  const exportAct = (): void => {
    const name = walkActFileName(plan);
    try {
      downloadCsv(walkActCsv(plan, walk?.route ?? []), name);
    } catch (reason) {
      setError(`Акт не выгружен: ${reason instanceof Error ? reason.message : String(reason)}`);
      return;
    }
    setError(null);
    setNotice(`Файл ${name} передан браузеру: строк ${discrepancies}.`);
  };

  const position = walk === null || current === undefined ? 0 : walk.route.indexOf(current.id) + 1;
  const number = current === undefined ? null : inventoryNumberOf(current);
  const currentMark = current === undefined ? null : walkMarkOf(current);
  const zoneName =
    current?.zoneId == null ? 'вне зон' : (plan.zones.find((zone) => zone.id === current.zoneId)?.name ?? current.zoneId);

  return (
    <section className="panel" aria-label="Обход для инвентаризации" data-testid="inventory-walk">
      <h2 className="panel__title">
        Обход <span className="panel__count">{counts.marked} из {total}</span>
      </h2>

      {walk === null ? (
        <div style={ROW_STYLE}>
          <button ref={startRef} type="button" className="files__button" disabled={total === 0} onClick={start} data-testid="walk-start">
            Начать обход
          </button>
          <span className="panel__note">маршрут от входа через все объекты</span>
        </div>
      ) : current === undefined ? (
        <p className="panel__note" data-testid="walk-done">Все объекты отмечены. Обход завершён.</p>
      ) : (
        <div data-testid="walk-current">
          <p className="panel__note">
            Объект {position} из {walk.route.length}:{' '}
            <button type="button" className="table__link" onClick={() => onFocus({ kind: 'object', id: current.id })}>
              {current.label}
            </button>{' '}
            <span className="table__muted">{current.id}</span>
            <br />
            Инв. № {number ?? '—'} · {zoneName}
            {currentMark === null ? '' : ` · уже отмечен: ${WALK_MARK_LABELS[currentMark]}`}
            {currentMark === 'other-number' ? ` ${walkFoundNumberOf(current) ?? ''}` : ''}
          </p>
          <div style={ROW_STYLE} role="group" aria-label="Отметка объекта">
            {QUICK_MARKS.map(({ mark: value, title }) => (
              <button key={value} ref={value === 'present' ? firstMarkRef : undefined} type="button" className="files__button" onClick={() => mark(value)} data-testid={`walk-mark-${value}`}>
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
          <div style={ROW_STYLE}>
            <button type="button" className="table__link" onClick={skip}>
              Пропустить
            </button>
          </div>
        </div>
      )}

      {walk === null ? null : (
        <div style={ROW_STYLE}>
          <button type="button" className="table__link" onClick={() => {
              onWalkChange(null);
              pendingFocus.current = 'start';
            }} data-testid="walk-stop">
            Завершить обход
          </button>
        </div>
      )}

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
