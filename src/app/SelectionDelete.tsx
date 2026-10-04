/**
 * #121: «Удалить» in the card of the selected thing — a button with its name,
 * not an icon in the header — and what the deletion costs, before the click.
 * Delete and Backspace do the same.
 */

import type { SelectionDeletion } from './selection-delete';

export function SelectionDelete({
  deletion,
  onDelete,
}: {
  deletion: SelectionDeletion;
  onDelete: () => void;
}): React.JSX.Element {
  return (
    <>
      <div className="props-quick__row">
        <button
          type="button"
          className="files__button is-danger"
          data-testid="selection-delete"
          disabled={deletion.command === null}
          title="То же делают клавиши Delete и Backspace"
          onClick={onDelete}
        >
          Удалить {deletion.label}
        </button>
      </div>
      {deletion.refusal === null ? null : <p className="props__hint">{deletion.refusal}</p>}
      {deletion.consequence === null ? null : (
        <p className="props__hint">{deletion.consequence} Отменить — Ctrl+Z.</p>
      )}
    </>
  );
}
