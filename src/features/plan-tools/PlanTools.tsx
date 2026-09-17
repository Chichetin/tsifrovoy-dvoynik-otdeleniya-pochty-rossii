/**
 * U03 (panel): choosing what the next click does.
 *
 * The toolbar owns no state of its own — the active tool lives in the editor
 * session, so a tool cannot stay highlighted while the canvas thinks otherwise.
 */

import type { PlanToolsProps } from '../../contracts/ui';
import type { ToolKind } from '../../contracts/ui';

const TOOLS: { kind: Exclude<ToolKind, 'object.place'>; label: string; hint: string }[] = [
  { kind: 'select', label: 'Выбор', hint: 'Выделять и перетаскивать объекты' },
  { kind: 'pan', label: 'Рука', hint: 'Двигать план; то же делает средняя кнопка мыши' },
  { kind: 'room.draw', label: 'Помещение', hint: 'Обвести границу помещения по точкам' },
  { kind: 'zone.draw', label: 'Зона', hint: 'Обвести зону; клик по первой точке замыкает' },
];

export function PlanTools({ session, onTool }: PlanToolsProps): React.JSX.Element {
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
      {session.tool.kind === 'object.place' ? (
        <span className="toolbar__note">Клик по плану ставит объект</span>
      ) : null}
    </div>
  );
}
