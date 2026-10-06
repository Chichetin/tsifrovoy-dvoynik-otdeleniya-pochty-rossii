/**
 * #179, mode B on screen: up to three options and «оставить как есть». A
 * chosen option is a dashed ghost on the plan; the object stays where it is
 * until «Подтвердить». Names are text, ids are in `title` (D-320).
 */

import { useEffect, useRef } from 'react';
import type { PlaceOption, PlaceSubject } from './place-suggestion';
import { placeSuggestionActions as act, usePlaceSuggestion } from './use-place-suggestion';
import './place-suggestion.css';

function subjectTitle(subject: Pick<PlaceSubject, 'kind' | 'id'>): string {
  return subject.kind === 'object' ? `id ${subject.id}` : `тип ${subject.id}`;
}

function OptionCard({
  option,
  chosen,
  disabled,
}: {
  option: PlaceOption;
  chosen: boolean;
  disabled: boolean;
}): React.JSX.Element {
  const keep = option.kind === 'keep';
  return (
    <li className={`place__option${chosen ? ' is-chosen' : ''}${keep ? ' is-keep' : ''}`} data-testid="place-option" data-option-id={option.id}>
      <p className="place__head">
        <strong>{option.title}</strong>
        {option.zone === '' ? null : (
          <span className="place__zone" title={option.zoneIds.length === 0 ? undefined : `id ${option.zoneIds.join(' → ')}`}>
            {option.zone}
          </span>
        )}
      </p>
      <p className="place__reason">{option.reason}</p>
      {option.numbers.length === 0 ? null : (
        <ul className="place__numbers">
          {option.numbers.map((number) => (
            <li key={number.label}>
              <span>{number.label}</span>
              <b>
                {number.before} → {number.after}
              </b>
            </li>
          ))}
        </ul>
      )}
      <div className="place__actions">
        {keep ? (
          <button type="button" className="files__button" disabled={disabled} onClick={act.leave}>
            {option.title}
          </button>
        ) : (
          <>
            <button
              type="button"
              className="files__button"
              aria-pressed={chosen}
              aria-label={`${chosen ? 'Показан на плане' : 'Показать на плане'}: ${option.title}`}
              disabled={disabled}
              data-place-show={option.id}
              onClick={() => (chosen ? act.dismiss() : act.choose(option.id))}
            >
              {chosen ? 'Показан на плане' : 'Показать на плане'}
            </button>
            {chosen ? (
              <>
                <button
                  type="button"
                  className="files__button is-primary"
                  aria-label={`Подтвердить: ${option.title}`}
                  data-place-confirm
                  onClick={act.confirm}
                >
                  Подтвердить
                </button>
                <button
                  type="button"
                  className="files__button"
                  aria-label={`Отклонить: ${option.title}`}
                  title="Убрать призрак с плана (Esc)"
                  onClick={act.dismiss}
                >
                  Отклонить
                </button>
              </>
            ) : null}
          </>
        )}
      </div>
    </li>
  );
}

export function PlaceSuggestion(): React.JSX.Element | null {
  const view = usePlaceSuggestion();
  const root = useRef<HTMLElement>(null);
  const chosen = view.status === 'done' ? view.chosen : null;
  const lastChosen = useRef<string | null>(null);

  // Keyboard: the answer takes focus when it arrives; a chosen option hands it
  // to «Подтвердить»; «Отклонить» returns it to the option's own button.
  useEffect(() => {
    const element = root.current;
    if (element === null) return;
    // A plan edit or Escape on the canvas also drops the ghost: focus stays where the person works.
    const inside = element.contains(window.document.activeElement) || window.document.activeElement === window.document.body;
    if (chosen !== null) element.querySelector<HTMLElement>('[data-place-confirm]')?.focus();
    else if (lastChosen.current !== null && inside) element.querySelector<HTMLElement>(`[data-place-show="${CSS.escape(lastChosen.current)}"]`)?.focus();
    lastChosen.current = chosen;
  }, [chosen]);
  useEffect(() => {
    const element = root.current;
    if (element === null) return;
    const inside = element.contains(window.document.activeElement) || window.document.activeElement === window.document.body;
    if (view.status === 'done' || (view.status === 'closed' && inside)) element.querySelector<HTMLElement>('[data-place-focus]')?.focus();
  }, [view.status]);

  if (view.status === 'idle') return null;

  const close = (
    <button type="button" className="place__close" aria-label="Закрыть «Предложить место»" title="Закрыть" onClick={act.close}>
      ×
    </button>
  );

  if (view.status === 'closed') {
    return (
      <section ref={root} className="place" aria-label="Предложить место">
        <div className="place__bar">
          <p className="place__done" role="status" tabIndex={-1} data-place-focus>
            {view.message}
          </p>
          {close}
        </div>
      </section>
    );
  }

  const subject =
    view.status === 'done'
      ? view.result.subject
      : { kind: 'objectId' in view.target ? ('object' as const) : ('type' as const), id: 'objectId' in view.target ? view.target.objectId : view.target.typeId, name: view.name };

  return (
    <section ref={root} className="place" aria-label="Предложить место" aria-busy={view.status === 'loading'}>
      <div className="place__bar">
        <h3 className="place__title" tabIndex={-1} data-place-focus>
          Предложить место:{' '}
          <span title={subjectTitle(subject)}>«{subject.name}»</span>
          {subject.kind === 'type' ? <span className="place__kind"> — новый объект</span> : null}
        </h3>
        {close}
      </div>

      {view.status === 'loading' ? (
        <p className="place__status" role="status">
          Считаем места…
        </p>
      ) : null}

      {view.status === 'error' ? (
        <>
          <p className="files__error" role="alert">
            Не удалось подобрать место: {view.message}
          </p>
          <button type="button" className="files__button" onClick={() => act.suggest(view.target)}>
            Повторить
          </button>
        </>
      ) : null}

      {view.status === 'done' ? (
        <>
          <p className="place__mode">Без LLM: обоснование собрано из расчёта. Объект не двигается, пока вы не нажмёте «Подтвердить».</p>
          {view.stale ? (
            <div className="assistant__stale" role="status">
              <p>План изменился после ответа: призрак убран, числа устарели.</p>
              <button type="button" className="files__button" onClick={() => act.suggest(view.target)}>
                Предложить заново
              </button>
            </div>
          ) : null}
          {view.result.options.every((option) => option.kind === 'keep') ? (
            <p className="place__status" role="status">
              {view.result.subject.locked
                ? 'Объект закреплён: снимите замок в «Свойствах», чтобы искать место.'
                : 'Расчёт не нашёл другого места без новых ошибок проверки.'}
            </p>
          ) : null}
          <ol className="place__options">
            {view.result.options.map((option) => (
              <OptionCard key={option.id} option={option} chosen={option.id === view.chosen} disabled={view.stale} />
            ))}
          </ol>
          {view.error === null ? null : (
            <p className="files__error" role="alert">
              {view.error}
            </p>
          )}
        </>
      ) : null}
    </section>
  );
}
