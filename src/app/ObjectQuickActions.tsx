/**
 * #105: the two things a person does to a selected object right after moving
 * it — turn it and, rarely, change its shape. They sit between the card's
 * band and its fields. The fields scroll (the card scrolls itself to the
 * selection), these must stay in view. They are not inside the card: its props
 * are a contract (`PropertiesPanelProps`) and this is a matter of the app's shell.
 *
 * Without the «Изменить форму» switch an object only moves and turns (the round
 * handle with an arrow on the plan, or these buttons). With it, the resize
 * handles appear, and a double click on the object opens the vertex mode.
 */

import type { ReactNode } from 'react';
import type { Equipment } from '../contracts/model';

export type ObjectQuickActionsProps = {
  object: Equipment;
  /** A locked object or layer, or a hidden layer: nothing here would act. */
  disabled: boolean;
  reshape: boolean;
  onReshape: (on: boolean) => void;
  /** Positive is clockwise (D-010). */
  onRotate: (deltaDeg: number) => void;
  /** More actions of the same card, below the switch (#121: «Удалить»). */
  children?: ReactNode;
};

export function ObjectQuickActions({
  object,
  disabled,
  reshape,
  onReshape,
  onRotate,
  children,
}: ObjectQuickActionsProps): React.JSX.Element {
  return (
    <section className="props-quick" aria-label="Действия с объектом" data-testid="object-quick-actions" data-entity-id={object.id}>
      <div className="props-quick__row">
        <span className="props-quick__label">Повернуть</span>
        <button
          type="button"
          className="files__button"
          disabled={disabled}
          title="На 90° против часовой стрелки"
          onClick={() => onRotate(-90)}
        >
          <span aria-hidden="true">↺</span> 90°
          <span className="props-quick__sr"> против часовой стрелки</span>
        </button>
        <button
          type="button"
          className="files__button"
          disabled={disabled}
          title="На 90° по часовой стрелке"
          onClick={() => onRotate(90)}
        >
          <span aria-hidden="true">↻</span> 90°
          <span className="props-quick__sr"> по часовой стрелке</span>
        </button>
      </div>
      <label
        className="props__line"
        title="Без галочки объект двигается и вращается (круглая ручка со стрелкой над ним). С галочкой появляются точки размера."
      >
        <input
          type="checkbox"
          checked={reshape}
          disabled={disabled}
          onChange={(event) => onReshape(event.target.checked)}
        />
        {' '}Изменить форму
      </label>
      {reshape ? (
        <p className="props__hint">
          Тяните за точки на рамке — меняется размер. Двойной щелчок по объекту — правка вершин.
        </p>
      ) : null}
      {children}
    </section>
  );
}
