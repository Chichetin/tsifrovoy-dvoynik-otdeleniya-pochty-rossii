/**
 * U03 (panel): choosing what the next click does, and saying what the last
 * gesture did.
 *
 * The toolbar owns no state of its own — the active tool lives in the editor
 * session, so a tool cannot stay highlighted while the canvas thinks otherwise.
 *
 * Two things the plan layer cannot do itself end up here. It draws on a canvas
 * and has no DOM, so a refused gesture is printed by this toolbar (see
 * `notice.ts`); and deleting the selected zone, wall or opening needs a button
 * as well as the Delete key, because a button is what a user finds without
 * being told. Both paths send the same command, so undo sees one step either
 * way.
 */

import type { Command } from '../../contracts/commands';
import type { Ref } from '../../contracts/model';
import type { PlanToolsProps, ToolKind } from '../../contracts/ui';
import { useNotice } from './notice';

const TOOLS: { kind: Exclude<ToolKind, 'object.place'>; label: string; hint: string }[] = [
  { kind: 'select', label: 'Выбор', hint: 'Выделять и перетаскивать объекты' },
  { kind: 'pan', label: 'Рука', hint: 'Двигать план; то же делает средняя кнопка мыши' },
  { kind: 'room.draw', label: 'Помещение', hint: 'Обвести границу помещения по точкам' },
  { kind: 'zone.draw', label: 'Зона', hint: 'Обвести зону; клик по первой точке замыкает' },
];

/** What the Delete key and the button remove, and how it is called in the UI. */
const DELETABLE = {
  zone: { command: 'zone.delete', label: 'зону' },
  wall: { command: 'wall.delete', label: 'перегородку' },
  opening: { command: 'opening.delete', label: 'проём' },
} as const satisfies Record<string, { command: Command['type']; label: string }>;

type Deletable = keyof typeof DELETABLE;

function deletable(selection: Ref | null): (Ref & { kind: Deletable }) | null {
  if (selection === null) return null;
  return selection.kind in DELETABLE ? (selection as Ref & { kind: Deletable }) : null;
}

/** What the current selection can be edited with, in one line. */
function editingHint(selection: Ref | null): string | null {
  if (selection === null) return null;
  if (selection.kind === 'zone' || selection.kind === 'room') {
    return 'Контур: тяните вершину, клик по ребру добавит вершину, двойной клик по вершине удалит';
  }
  if (selection.kind === 'wall') return 'Перегородка: тяните концы';
  if (selection.kind === 'opening') return 'Проём: тяните вдоль стены';
  return null;
}

export function PlanTools({ session, onTool, onCommand }: PlanToolsProps): React.JSX.Element {
  const notice = useNotice();
  const target = deletable(session.selection);
  const hint = editingHint(session.selection);

  return (
    <div className="toolbar" role="toolbar" aria-label="Инструменты плана">
      {TOOLS.map((tool) => (
        <button
          key={tool.kind}
          type="button"
          title={tool.hint}
          aria-pressed={session.tool.kind === tool.kind}
          className={session.tool.kind === tool.kind ? 'toolbar__button is-active' : 'toolbar__button'}
          onClick={() => onTool({ kind: tool.kind })}
        >
          {tool.label}
        </button>
      ))}

      {target === null ? null : (
        <button
          type="button"
          className="toolbar__button"
          title="То же делает клавиша Delete"
          onClick={() => onCommand({ type: DELETABLE[target.kind].command, id: target.id })}
        >
          Удалить {DELETABLE[target.kind].label}
        </button>
      )}

      {session.tool.kind === 'object.place' ? (
        <span className="toolbar__note">Клик по плану ставит объект</span>
      ) : null}
      {hint === null ? null : <span className="toolbar__note">{hint}</span>}

      {notice === null ? null : (
        <span
          className="toolbar__note"
          style={{ color: 'var(--error)' }}
          role="status"
          data-testid="plan-tools-notice"
        >
          {notice}
        </span>
      )}
    </div>
  );
}
