/**
 * UX-3: единственный список горячих клавиш редактора. Накладка «?»
 * (`HotkeysMapDialog`) читает `HOTKEYS_MAP`, а не свою копию разметки — новая
 * горячая клавиша добавляется одной строкой здесь и появляется в накладке
 * сама, без правки компонента.
 *
 * Числа шагов не переписаны текстом, а посчитаны от тех же констант, что
 * держат сами обработчики (`NUDGE_STEP_M`, `NUDGE_FINE_STEP_M`,
 * `ROTATION_SNAP_DEG` — `src/features/equipment`): значение стало неверным —
 * эта строка тоже станет неверной, а не соврёт молча.
 *
 * Файл лежит в `src/app`, а не в `src/features/editor` или
 * `src/features/equipment`, потому что список сводит хоткеи обеих features, а
 * граница импортов (`docs/project-structure.md`) не даёт одной feature
 * читать файлы другой — сводить их может только то, что стоит над обеими.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { NUDGE_FINE_STEP_M, NUDGE_STEP_M } from '../features/equipment/selection-edit';
import { ROTATION_SNAP_DEG } from '../features/equipment/transform';
import { isHotkeysMapHotkey, type HotkeyEvent } from '../features/editor/hotkeys';
import { formatShort, NBSP } from '../domain/number-format';

export type HotkeyMapEntry = { keys: string; description: string };
export type HotkeyMapGroup = { title: string; entries: readonly HotkeyMapEntry[] };

const nudgeStep = `${formatShort(NUDGE_STEP_M, 2)}${NBSP}м`;
const nudgeFineStep = `${formatShort(NUDGE_FINE_STEP_M, 2)}${NBSP}м`;
const rotationStep = `${formatShort(ROTATION_SNAP_DEG, 1)}°`;

export const HOTKEYS_MAP: readonly HotkeyMapGroup[] = [
  {
    title: 'Вид',
    entries: [{ keys: 'F', description: 'Вписать план в окно' }],
  },
  {
    title: 'Выделенный объект',
    entries: [
      { keys: '↑ ↓ ← →', description: `Сдвинуть на ${nudgeStep}` },
      { keys: 'Shift + стрелка', description: `Сдвинуть на мелкий шаг, ${nudgeFineStep}` },
      { keys: 'R', description: `Повернуть на ${rotationStep} по часовой` },
      { keys: 'Shift+R', description: `Повернуть на ${rotationStep} против часовой` },
      { keys: 'Ctrl+C затем Ctrl+V', description: 'Скопировать, затем вставить со смещением' },
      { keys: 'Ctrl+D', description: 'Дублировать со смещением, без буфера обмена' },
      { keys: 'Delete или Backspace', description: 'Удалить' },
    ],
  },
  {
    title: 'История',
    entries: [
      { keys: 'Ctrl+Z', description: 'Отменить последнюю правку' },
      { keys: 'Ctrl+Shift+Z или Ctrl+Y', description: 'Вернуть отменённую правку' },
    ],
  },
  {
    title: 'Разное',
    entries: [
      { keys: 'Enter', description: 'Замкнуть контур помещения или зоны (от трёх точек); для выделенного проёма — снять выделение, как «готово»' },
      { keys: 'Esc', description: 'Отменить текущий жест или рамку выделения' },
      { keys: '?', description: 'Показать или скрыть эту карту клавиш' },
    ],
  },
];

export type HotkeysMapDialogController = {
  open: boolean;
  show: () => void;
  hide: () => void;
};

/**
 * Открытие/закрытие накладки: `?` переключает, `Escape` закрывает, повторный
 * `?` — тоже закрывает (тот же переключатель, не отдельная ветка). Фокус,
 * который был на странице до открытия, возвращается на своё место при
 * закрытии — так же, как того требует D-195 у обучения.
 */
export function useHotkeysMapDialog(): HotkeysMapDialogController {
  const [open, setOpen] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);

  // Стабильные ссылки (D-195, как `closeTour` в `App.tsx`): `HotkeysMapDialog`
  // держит `onClose` в зависимостях своего capture-эффекта, и новая функция на
  // каждый рендер App пересоздавала бы слушатель посреди диспетчеризации того
  // же нажатия — событие снималось бы до того, как до него дойдёт очередь, и
  // Escape переставал закрывать карту.
  const show = useCallback((): void => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, []);
  const hide = useCallback((): void => {
    setOpen(false);
    returnFocus.current?.focus();
    returnFocus.current = null;
  }, []);

  // Открывает карту по `?`, пока она закрыта. Обычная (bubble) фаза — блокировать
  // здесь ещё нечего, карты на экране нет. Пока карта открыта, клавиатура
  // принадлежит ей одной — этим занимается сам `HotkeysMapDialog` (capture-фаза,
  // тот же приём, что у `Onboarding.tsx`), а не этот хук: у закрытого диалога
  // (компонент не смонтирован) нечего перехватывать.
  useEffect(() => {
    if (open) return;
    const onKey = (event: KeyboardEvent): void => {
      const hotkeyEvent: HotkeyEvent = event;
      if (isHotkeysMapHotkey(hotkeyEvent)) {
        event.preventDefault();
        show();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, show]);

  return { open, show, hide };
}
