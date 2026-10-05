/**
 * #176, mode A «Подсказки»: what the last edit changed, said by code.
 *
 * The switch sits at the top of the assistant panel. The newest hint is open,
 * older ones fold under «Ранее». A name is a button: it rings the entity on the
 * plan, the id is in `title` (D-320). «Объяснить» hands the hint to the chat;
 * without a model the chat answers with the calculation.
 */

import type { Ref } from '../../contracts/model';
import { editHintNumbers } from '../../domain/advice';
import type { PlanIndex } from '../../domain/plan-index';
import { clearHints, setHintsEnabled, useEditHints, type ShownHint } from './use-assistant-session';
import './edit-hints.css';

function FocusText({
  text,
  target,
  names,
  onFocus,
}: {
  text: string;
  target: Ref | undefined | null;
  names: PlanIndex;
  onFocus: (ref: Ref) => void;
}): React.JSX.Element {
  // A later edit may have taken the entity away: the text stays, the button goes.
  if (target === undefined || target === null || names.nameOf(target) === null) return <span>{text}</span>;
  return (
    <button
      type="button"
      className="hint__link"
      title={`Показать на плане · id ${target.id}`}
      data-ref-id={target.id}
      onClick={() => onFocus(target)}
    >
      {text}
    </button>
  );
}

function HintCard({
  hint,
  names,
  onFocus,
  onExplain,
}: {
  hint: ShownHint;
  names: PlanIndex;
  onFocus: (ref: Ref) => void;
  onExplain?: (question: string) => void;
}): React.JSX.Element {
  const numbers = editHintNumbers(hint);
  return (
    <article className="hint" data-testid="edit-hint">
      <p className="hint__subject">
        <FocusText text={hint.subject} target={hint.target} names={names} onFocus={onFocus} />
      </p>
      {hint.items.length === 0 ? null : (
        <ul className="hint__items">
          {hint.items.map((item) => (
            <li key={item.key} className={`hint__item is-${item.tone}`}>
              <FocusText text={item.text} target={item.refs[0]} names={names} onFocus={onFocus} />
            </li>
          ))}
          {hint.more === 0 ? null : <li className="hint__item">Ещё причин: {hint.more} — полный список в «Проверке».</li>}
        </ul>
      )}
      {numbers.length === 0 ? null : <p className="hint__numbers">{numbers.join(' ')}</p>}
      <p className="hint__footer">
        <span className="hint__mode">Расчёт кода, без LLM</span>
        {onExplain === undefined ? null : (
          <button
            type="button"
            className="files__button hint__explain"
            onClick={() => onExplain(`Объясни подсказку и что поправить: ${hint.text}`)}
          >
            Объяснить
          </button>
        )}
      </p>
    </article>
  );
}

export function EditHints({
  names,
  onFocus,
  onExplain,
}: {
  names: PlanIndex;
  onFocus: (ref: Ref) => void;
  onExplain?: (question: string) => void;
}): React.JSX.Element {
  const { enabled, hints } = useEditHints();
  const [latest, ...older] = hints;
  return (
    <div className="hints">
      <div className="hints__bar">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          className="hints__switch"
          title="После каждой правки код сравнивает план «до» и «после». LLM не вызывается."
          onClick={() => setHintsEnabled(!enabled)}
        >
          <span className="hints__track" aria-hidden="true" />
          Подсказки
        </button>
        {enabled && hints.length > 0 ? (
          <button type="button" className="hints__clear" onClick={clearHints}>
            Очистить
          </button>
        ) : null}
      </div>
      {enabled ? (
        <div className="hints__list" aria-live="polite">
          {latest === undefined ? (
            <p className="hints__empty">Правьте план — здесь появится, что изменила правка.</p>
          ) : (
            <HintCard key={latest.id} hint={latest} names={names} onFocus={onFocus} onExplain={onExplain} />
          )}
          {older.length === 0 ? null : (
            <details className="hints__older">
              <summary>Ранее ({older.length})</summary>
              {older.map((hint) => (
                <HintCard key={hint.id} hint={hint} names={names} onFocus={onFocus} onExplain={onExplain} />
              ))}
            </details>
          )}
        </div>
      ) : null}
    </div>
  );
}
