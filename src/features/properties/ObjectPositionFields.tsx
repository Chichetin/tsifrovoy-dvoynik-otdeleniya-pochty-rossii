import { useId, useState } from 'react';
import type { Equipment, Point } from '../../contracts/model';
import type { CommandSink } from '../../contracts/ui';

const parse = (raw: string): number | null => {
  const value = Number(raw.replace(',', '.'));
  return raw.trim() !== '' && Number.isFinite(value) ? value : null;
};

/** X and Y form one edit: an intermediate point may collide while the target is free. */
export function ObjectPositionFields({ object, position, onCommand, moving }: {
  object: Equipment; position: Point; onCommand: CommandSink; moving: boolean;
}): React.JSX.Element {
  const [draft, setDraft] = useState<[string, string]>(() => position.map(String) as [string, string]);
  const [refusal, setRefusal] = useState<string | null>(null);
  const hintId = useId();
  const errorId = useId();
  const parsed = draft.map(parse);
  const invalid = parsed.some((value) => value === null);
  const changed = parsed.some((value, index) => value !== position[index]);
  const reset = (): void => {
    setDraft(position.map(String) as [string, string]);
    setRefusal(null);
  };
  return (
    <form className="props__position" aria-label="Координаты объекта" noValidate
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); reset(); }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (invalid || moving || !changed) return;
        const result = onCommand({ type: 'object.put', object: { ...object, position: [parsed[0]!, parsed[1]!] } });
        setRefusal(result.ok ? null : result.issues.map((issue) => issue.message).join('; '));
      }}>
      <div className="props__pair">
        {(['X, м', 'Y, м'] as const).map((label, index) => (
          <label className="props__field" key={label}>
            <span className="props__label">{label}</span>
            <input type="number" step="0.1" aria-label={label} value={draft[index]}
              disabled={moving} aria-invalid={parsed[index] === null || refusal !== null}
              aria-describedby={`${hintId}${invalid || refusal !== null ? ` ${errorId}` : ''}`}
              onChange={(event) => {
                const value = event.target.value;
                setDraft((current) => index === 0 ? [value, current[1]] : [current[0], value]);
                setRefusal(null);
              }} />
          </label>
        ))}
      </div>
      <p className="props__hint" id={hintId}>X и Y применяются вместе. Enter — применить, Esc — сбросить.</p>
      {invalid || refusal !== null ? <p className="props__error" id={errorId} role="alert">
        {invalid ? 'Нужно число для каждой координаты.' : refusal}
      </p> : null}
      <div className="props__position-actions">
        <button type="submit" className="files__button" disabled={moving || !changed}>Применить координаты</button>
        <button type="button" className="files__button" onClick={reset} disabled={moving || !changed}>Сбросить координаты</button>
      </div>
    </form>
  );
}
