/**
 * D-288: маленькое модальное окно для двух вопросов о файле — «восстановить
 * черновик?» и «план нарушает физику, всё равно сохранить?».
 *
 * Своё, а не общее с `HotkeysMapDialog`: тот живёт в `src/app`, а feature не
 * читает файлы приложения (`docs/project-structure.md`). Приёмы те же и
 * названы теми же словами: фокус уходит в диалог при открытии, `Escape` и
 * клик по подложке отвечают «нет», `Tab` не выпускает фокус наружу,
 * `role="dialog"` с `aria-modal` говорит читалке экрана, что это отдельный
 * слой. Нажатия не доходят до холста: пока окно открыто, `Delete` и стрелки
 * не должны двигать объект за ним.
 *
 * `onClose` — это всегда «нет»: закрытие ничего не делает с планом. Действия
 * приходят кнопками в `actions`.
 */

import { useEffect, useRef } from 'react';

export type FileDialogProps = {
  title: string;
  /** Описание для читалки экрана: связывается с телом окна. */
  describedBy?: string;
  onClose: () => void;
  children: React.ReactNode;
  actions: React.ReactNode;
  testId?: string;
};

function focusables(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).filter(
    (button) => !button.disabled,
  );
}

export function FileDialog({
  title,
  describedBy,
  onClose,
  children,
  actions,
  testId,
}: FileDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (dialog === null) return;
      const items = focusables(dialog);
      if (items.length === 0) return;
      const at = items.indexOf(window.document.activeElement as HTMLElement);
      const target = event.shiftKey
        ? at <= 0 ? items.at(-1)! : items[at - 1]!
        : at === -1 || at === items.length - 1 ? items[0]! : items[at + 1]!;
      event.preventDefault();
      target.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <div
      className="file-dialog"
      data-testid={testId}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="file-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-describedby={describedBy}
        tabIndex={-1}
      >
        <h2 className="file-dialog__title">{title}</h2>
        <div className="file-dialog__body" id={describedBy}>
          {children}
        </div>
        <div className="file-dialog__actions">{actions}</div>
      </div>
    </div>
  );
}
