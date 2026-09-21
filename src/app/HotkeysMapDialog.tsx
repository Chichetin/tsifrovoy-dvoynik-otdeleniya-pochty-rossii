/**
 * UX-3: накладка «карта горячих клавиш», открывается по `?` или кнопкой в
 * шапке. Открытие/закрытие и данные — в `hotkeys-map.ts`; этот файл рисует
 * список и держит доступность: фокус уходит в диалог при открытии, `Escape`
 * и клик по подложке закрывают, `role="dialog"` с `aria-modal` говорит
 * читалке экрана, что это отдельный слой поверх страницы.
 *
 * Пока накладка открыта, она модальна и клавиатуре — тем же приёмом, что у
 * `src/features/onboarding/Onboarding.tsx`: слушатель на `window` в
 * capture-фазе идёт раньше слушателей редактора, зарегистрированных в
 * обычной (bubble) фазе — Delete/R/стрелки/Ctrl+D в `EquipmentLayer`,
 * Ctrl+Z/Y в `App`, — и `stopPropagation` не даёт событию дойти до них:
 * иначе объект за накладкой удалялся бы или поворачивался, пока пользователь
 * читает список клавиш. Tab внутри диалога не выпускает фокус — простой
 * цикл по фокусируемым узлам, Shift+Tab идёт в обратную сторону.
 *
 * `onClose` обязан быть стабильной ссылкой (как `closeTour` в `App.tsx`,
 * `useCallback` в `hotkeys-map.ts`): эффект держит его в зависимостях, и
 * новая функция на каждый рендер `App` пересобирала бы слушатель — при
 * невезении ровно в разгаре обработки того самого нажатия, которое должно
 * было её закрыть (старый слушатель уже снят, новый ещё не встал в очередь
 * этого события), и Escape переставал закрывать карту.
 */

import { useEffect, useRef } from 'react';
import { isHotkeysMapHotkey, type HotkeyEvent } from '../features/editor/hotkeys';
import { HOTKEYS_MAP } from './hotkeys-map';

export type HotkeysMapDialogProps = {
  open: boolean;
  onClose: () => void;
};

function focusables(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).filter((button) => !button.disabled);
}

export function HotkeysMapDialog({ open, onClose }: HotkeysMapDialogProps): React.JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      event.stopPropagation();
      const hotkeyEvent: HotkeyEvent = event;
      if (event.code === 'Escape' || isHotkeysMapHotkey(hotkeyEvent)) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (dialog === null) return;
      const items = focusables(dialog);
      if (items.length === 0) return;
      const at = items.indexOf(document.activeElement as HTMLElement);
      const target = event.shiftKey
        ? at <= 0 ? items.at(-1)! : items[at - 1]!
        : at === -1 || at === items.length - 1 ? items[0]! : items[at + 1]!;
      event.preventDefault();
      target.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

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
