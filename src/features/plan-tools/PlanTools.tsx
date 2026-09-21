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
 * being told. Both paths send the same command through `delete-key.ts`, so undo
 * sees one step either way and the rules cannot drift apart.
 *
 * The refusal line is about one gesture over one shape: it goes out when the
 * user selects something else or opens another plan, and never outlives the
 * document it was printed for.
 */

import { Fragment, useEffect } from 'react';
import type { Ref } from '../../contracts/model';
import type { PlanToolsProps, ToolKind } from '../../contracts/ui';
import { deleteIntent } from './delete-key';
import { setNotice, useNotice } from './notice';

/**
 * Первые два инструмента («Выбор», «Обзор») меняют, что видно и что выделено;
 * остальные создают геометрию плана. Разделитель между группами рисует стиль
 * (`toolbar__group-gap`), а не пустая кнопка — граница видна и без hover.
 */
const VIEW_TOOL_COUNT = 2;

const TOOLS: { kind: Exclude<ToolKind, 'object.place'>; label: string; hint: string }[] = [
  { kind: 'select', label: 'Выбор', hint: 'Выделять и перетаскивать; Alt — без привязки' },
  {
    kind: 'pan',
    // D-248: «Рука» не говорит, что произойдёт — инструмент двигает и
    // масштабирует вид, а не хватает план рукой; «Обзор» короче
    // «Панорамирования» и не путается с «Помещением» на слух.
    label: 'Обзор',
    hint:
      'Двигать вид плана: средняя кнопка мыши или свайп двумя пальцами на тачпаде; ' +
      'колесо и Ctrl+колесо — масштаб',
  },
  { kind: 'room.draw', label: 'Помещение', hint: 'Обвести границу по точкам; Alt — без привязки' },
  { kind: 'zone.draw', label: 'Зона', hint: 'Обвести зону; Alt — без привязки' },
  {
    kind: 'wall.draw',
    label: 'Перегородка',
    hint: 'Два клика: начало и конец; Alt — без привязки',
  },
  {
    kind: 'opening.place',
    label: 'Проём',
    hint: 'Клик по стене ставит дверь; вид и размер правятся в карточке свойств',
  },
];

/** Что именно сейчас выбрано — ключом строки, а не ссылкой на объект. */
function selectionKey(selection: Ref | null): string {
  return selection === null ? '' : `${selection.kind}:${selection.id}`;
}

/** What the current selection can be edited with, in one line. */
function editingHint(selection: Ref | null): string | null {
  if (selection === null) return null;
  if (selection.kind === 'zone' || selection.kind === 'room') {
    return 'Контур: тяните вершину; Alt — без привязки; клик по ребру добавит вершину';
  }
  if (selection.kind === 'wall') return 'Перегородка: тяните концы; Alt — без привязки';
  if (selection.kind === 'opening') return 'Проём: тяните вдоль стены';
  return null;
}

export function PlanTools({
  document: plan,
  session,
  onTool,
  onCommand,
}: PlanToolsProps): React.JSX.Element {
  const notice = useNotice();
  const intent = deleteIntent(session.selection, plan);
  const hint = editingHint(session.selection);
  const selected = selectionKey(session.selection);
  // Другой документ — это «Новый» или открытый файл: план опознаётся по id и
  // имени, а не по ссылке, иначе строку гасила бы любая правка.
  const document = `${plan.id}\u0000${plan.name}`;

  useEffect(() => {
    setNotice(null);
  }, [selected, document]);

  return (
    <div className="toolbar" role="toolbar" aria-label="Инструменты плана">
      {TOOLS.map((tool, index) => (
        <Fragment key={tool.kind}>
          <button
            type="button"
            title={tool.hint}
            aria-pressed={session.tool.kind === tool.kind}
            className={session.tool.kind === tool.kind ? 'toolbar__button is-active' : 'toolbar__button'}
            onClick={() => onTool({ kind: tool.kind })}
          >
            {tool.label}
          </button>
          {/* Разрыв сегментированного вида между «Выбор/Обзор» и инструментами
              создания: последние не относятся к сегменту с общей рамкой. */}
          {index === VIEW_TOOL_COUNT - 1 ? (
            <span className="toolbar__group-gap" aria-hidden="true" />
          ) : null}
        </Fragment>
      ))}

      {intent?.kind !== 'delete' ? null : (
        <button
          type="button"
          className="toolbar__button"
          title="То же делают клавиши Delete и Backspace"
          onClick={() => onCommand(intent.command)}
        >
          Удалить {intent.label}
        </button>
      )}

      {/* Hints live in a plaque over the canvas, not in the header row: a long
          line there wrapped the header and moved the plan (operator №16). */}
      {session.tool.kind !== 'object.place' && hint === null && notice === null ? null : (
        <div className="toolbar__hints">
          {session.tool.kind === 'object.place' ? (
            <span className="toolbar__note">Клик по плану ставит объект</span>
          ) : null}
          {hint === null ? null : <span className="toolbar__note">{hint}</span>}

          {notice === null ? null : (
            <span className="toolbar__note is-notice" role="status" data-testid="plan-tools-notice">
              {notice}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
