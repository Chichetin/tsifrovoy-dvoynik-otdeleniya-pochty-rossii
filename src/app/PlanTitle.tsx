import { useEffect, useId, useRef, useState } from 'react';
import { renameOutcome } from './plan-title';

type PlanTitleProps = {
  name: string;
  /** Edits since the plan was opened from or exported to a file (store `dirty`). */
  dirty: boolean;
  /** Sends `plan.rename`; `false` when the command was refused. */
  onRename: (name: string) => boolean;
};

const EMPTY_HINT = 'У плана должно быть название.';

/**
 * D-350: the plan name is always in the header, like a document name in an
 * editor, and renames in place. Next to it — whether the edits are in a file:
 * a mark that differs by shape and colour, its words in the tooltip and in a
 * status region for screen readers.
 */
export function PlanTitle({ name, dirty, onRename }: PlanTitleProps): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  const nameButton = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // Enter or Escape closes the field; the blur that follows must not decide again.
  const closing = useRef(false);
  const returnFocus = useRef(false);
  const hintId = useId();
  const editing = draft !== null;

  useEffect(() => {
    if (editing) {
      input.current?.select();
      return;
    }
    if (returnFocus.current) {
      returnFocus.current = false;
      nameButton.current?.focus();
    }
  }, [editing]);

  const close = (focusName: boolean): void => {
    closing.current = true;
    returnFocus.current = focusName;
    setDraft(null);
    setEmpty(false);
  };

  /** `byEnter`: an empty name keeps the field with a hint; leaving the field just cancels. */
  const finish = (byEnter: boolean): void => {
    if (draft === null) return;
    const outcome = renameOutcome(draft, name);
    if (outcome.kind === 'cancel') return close(byEnter);
    if (outcome.kind === 'empty') {
      if (byEnter) setEmpty(true);
      else close(false);
      return;
    }
    if (onRename(outcome.name)) close(byEnter);
  };

  // #105: the short text is painted next to the name; the tooltip says it in full.
  const state = dirty ? 'Есть несохранённые правки' : 'Сохранено в файл';
  const stateShort = dirty ? 'Не сохранено' : 'Сохранено';

  return (
    <div className="shell__doc">
      {draft === null ? (
        <button
          ref={nameButton}
          type="button"
          className="shell__doc-name"
          aria-label={`Переименовать план «${name}»`}
          title={`${name} — нажмите, чтобы переименовать`}
          onClick={() => {
            closing.current = false;
            setDraft(name);
          }}
        >
          {name}
        </button>
      ) : (
        <span className="shell__doc-edit">
          <input
            ref={input}
            className="shell__doc-input"
            aria-label="Новое название плана"
            aria-invalid={empty}
            aria-describedby={empty ? hintId : undefined}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setEmpty(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                finish(true);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                close(true);
              }
            }}
            onBlur={() => {
              if (closing.current) return;
              finish(false);
            }}
          />
          {empty ? (
            <span id={hintId} className="shell__doc-hint" role="alert">
              {EMPTY_HINT}
            </span>
          ) : null}
        </span>
      )}
      <span className={dirty ? 'shell__doc-state is-dirty' : 'shell__doc-state'} title={state}>
        <span aria-hidden="true">{dirty ? '●' : '✓'}</span>
        <span className="shell__doc-state-text" role="status">
          {stateShort}
        </span>
      </span>
    </div>
  );
}
