/**
 * UX-3: накладка «карта горячих клавиш», открывается по `?` или кнопкой в
 * шапке. Открытие/закрытие и данные — в `hotkeys-map.ts`; этот файл только
 * рисует список и держит доступность: фокус уходит в диалог при открытии,
 * `Escape` и клик по подложке закрывают, `role="dialog"` с `aria-modal`
 * говорит читалке экрана, что это отдельный слой поверх страницы.
 */

import { useEffect, useRef } from 'react';
import { HOTKEYS_MAP } from './hotkeys-map';

export type HotkeysMapDialogProps = {
  open: boolean;
  onClose: () => void;
};

export function HotkeysMapDialog({ open, onClose }: HotkeysMapDialogProps): React.JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div className="hotkeys-map" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        className="hotkeys-map__dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Горячие клавиши"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="hotkeys-map__header">
          <h2 className="hotkeys-map__title">Горячие клавиши</h2>
          <button type="button" className="hotkeys-map__close" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </div>
        {HOTKEYS_MAP.map((group) => (
          <section key={group.title} className="hotkeys-map__group">
            <h3 className="hotkeys-map__group-title">{group.title}</h3>
            <dl className="hotkeys-map__list">
              {group.entries.map((entry) => (
                <div key={entry.keys} className="hotkeys-map__row">
                  <dt className="hotkeys-map__keys">
                    <kbd>{entry.keys}</kbd>
                  </dt>
                  <dd className="hotkeys-map__description">{entry.description}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}
