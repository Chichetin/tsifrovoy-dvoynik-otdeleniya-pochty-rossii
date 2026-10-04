import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Equipment, Point } from '../../contracts/model';
import { OBJECT_MENU_ITEMS, type ObjectMenuAction } from './object-menu';

const EDGE_PX = 8;

/**
 * The menu of one object, opened by a right click or `Shift+F10` (#24). A real
 * menu for the keyboard: focus goes to the first item, arrows move, `Enter`
 * runs, `Escape` or a click elsewhere closes it.
 */
export function ObjectContextMenu({
  object,
  count = 1,
  at,
  onAction,
  onClose,
}: {
  object: Equipment;
  /** More than one: the actions act on the picked group, and the title says so. */
  count?: number;
  /** Window coordinates of the click, or of the object for the keyboard. */
  at: Point;
  onAction: (action: ObjectMenuAction) => void;
  onClose: () => void;
}): React.JSX.Element {
  const menu = useRef<HTMLDivElement>(null);
  const title = count > 1 ? `Выбрано объектов: ${count}` : object.label;

  // The menu opens at the pointer but never leaves the window.
  useLayoutEffect(() => {
    const element = menu.current;
    if (element === null) return;
    element.style.left = `${Math.max(EDGE_PX, Math.min(at[0], window.innerWidth - element.offsetWidth - EDGE_PX))}px`;
    element.style.top = `${Math.max(EDGE_PX, Math.min(at[1], window.innerHeight - element.offsetHeight - EDGE_PX))}px`;
    element.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [at]);

  useEffect(() => {
    const away = (event: PointerEvent): void => {
      if (event.target instanceof Node && menu.current?.contains(event.target) === true) return;
      onClose();
    };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  const move = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    // Arrows, R, Delete and Ctrl+D belong to the menu while it is open: the plan
    // behind it listens on the window and would move or delete the object.
    event.stopPropagation();
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      onClose();
      return;
    }
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    const target =
      event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : step === 0 ? null : (items.indexOf(window.document.activeElement as HTMLElement) + step + items.length) % items.length;
    if (target === null) return;
    event.preventDefault();
    items[target]?.focus();
  };

  return (
    <div
      ref={menu}
      className="object-menu"
      role="menu"
      aria-label={`Действия: ${title}`}
      data-testid="object-menu"
      onKeyDown={move}
      onContextMenu={(event) => event.preventDefault()}
    >
      <p className="object-menu__title" aria-hidden="true">
        {title}
      </p>
      {OBJECT_MENU_ITEMS.map((item) => (
        <button
          key={item.action}
          type="button"
          role="menuitem"
          className="object-menu__item"
          data-testid={`object-menu-${item.action}`}
          onClick={() => onAction(item.action)}
        >
          <span>{item.label}</span>
          {item.keys === '' ? null : <kbd>{item.keys}</kbd>}
        </button>
      ))}
    </div>
  );
}
