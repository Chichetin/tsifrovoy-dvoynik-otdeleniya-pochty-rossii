/**
 * UX №2: the rules of the first-run tour, without DOM.
 *
 * What the steps say, whether this browser has already seen them, and where
 * the card goes next to a highlighted panel. The fact that the tour was seen
 * lives in localStorage only — it is a property of the browser, not of the
 * plan, and never reaches the plan file (D-193).
 */

/**
 * Panels a step can point at. The app marks them with `data-tour="<target>"`;
 * the tour finds them by that attribute and never imports another module.
 */
export type TourTarget = 'files' | 'tools' | 'side-left' | 'side-right';

export type TourStep = {
  id: string;
  title: string;
  text: string;
  targets: readonly TourTarget[];
};

/** How the tour ended: both mean "do not show it on the next visit". */
export type TourOutcome = 'done' | 'skipped';

/** The reviewer's path: open → change → check → save and open again. */
export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'open',
    title: 'Откройте план отделения',
    text:
      'Готовый план открывается кнопкой «Открыть»: в комплекте есть файл demo/before.json — ' +
      'условное отделение с зонами, оборудованием и инвентарными номерами. ' +
      'Начать с чистого листа — кнопка «Новый»: пустое помещение, которое вы обрисуете сами.',
    targets: ['files'],
  },
  {
    id: 'edit',
    title: 'Измените план',
    text:
      'Инструменты вверху обводят помещение и зоны, ставят перегородки и проёмы. ' +
      'Оборудование берётся из «Библиотеки» в левой панели, под слоями, и ставится кликом по плану. ' +
      'Выбранный на плане объект открывается справа в «Свойствах»: размеры, поворот, зона, атрибуты.',
    targets: ['tools', 'side-left'],
  },
  {
    id: 'check',
    title: 'Проверьте план и спросите ассистента',
    text:
      'Справа — проверка плана, площади и инвентаризация; они пересчитываются после каждой правки, ' +
      'а находки подсвечиваются на плане. Ассистент подбирает место под рабочее место, окно или ' +
      'стеллаж, сверяет комплектование с правилами и показывает эффект «было → стало».',
    targets: ['side-right'],
  },
  {
    id: 'save',
    title: 'Сохраните и откройте заново',
    text:
      '«Сохранить» скачивает план файлом .json — в нём зоны, оборудование, идентификаторы и атрибуты. ' +
      'Этот же файл снова открывается кнопкой «Открыть». ' +
      'Пройти обучение ещё раз можно кнопкой «Обучение» внизу левой панели.',
    targets: ['files'],
  },
];

/** Versioned: a rewritten tour gets a new key and is shown again. */
export const ONBOARDING_KEY = 'ops-twin.onboarding.v1';

/** The slice of `localStorage` the tour uses, so tests can pass their own. */
export type TourStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** The browser's storage, if it is reachable at all: private mode throws on access. */
export function browserStorage(): TourStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Show on the first visit, and whenever the browser cannot tell. */
export function shouldShowTour(storage: TourStorage | null): boolean {
  if (storage === null) return true;
  try {
    return storage.getItem(ONBOARDING_KEY) === null;
  } catch {
    return true;
  }
}

/** Remembers that the tour was seen; `false` when the browser refused. */
export function rememberTour(storage: TourStorage | null, outcome: TourOutcome): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(ONBOARDING_KEY, outcome);
    return true;
  } catch {
    return false;
  }
}

export function nextStep(step: number, total: number): number {
  return Math.min(step + 1, total - 1);
}

export function previousStep(step: number): number {
  return Math.max(step - 1, 0);
}

export type Box = { left: number; top: number; width: number; height: number };
export type Size = { width: number; height: number };

/** Distance between the card, the highlighted panel and the screen edge, px. */
const GAP = 12;

function clamp(value: number, max: number): number {
  return Math.max(Math.min(value, max), GAP);
}

/**
 * Where the card goes: beside a tall side panel, below a short one (above when
 * the screen ends), in the middle when nothing is highlighted. With several
 * panels the tall one decides — a card under the toolbar would land on it.
 * Always inside the screen, so the buttons — «Пропустить» first of all — stay
 * reachable.
 */
export function placeCard(targets: readonly Box[], card: Size, screen: Size): { left: number; top: number } {
  const tall = (box: Box): boolean => box.height > screen.height / 2;
  const target = targets.find(tall) ?? targets[0] ?? null;
  const maxLeft = screen.width - card.width - GAP;
  const maxTop = screen.height - card.height - GAP;
  if (target === null) {
    return {
      left: clamp((screen.width - card.width) / 2, maxLeft),
      top: clamp((screen.height - card.height) / 2, maxTop),
    };
  }
  const right = target.left + target.width;
  const bottom = target.top + target.height;
  if (tall(target)) {
    const besideRight = right + GAP + card.width <= screen.width - GAP;
    return {
      left: clamp(besideRight ? right + GAP : target.left - GAP - card.width, maxLeft),
      top: clamp(target.top, maxTop),
    };
  }
  const fitsBelow = bottom + GAP + card.height <= screen.height - GAP;
  return {
    left: clamp(target.left, maxLeft),
    top: clamp(fitsBelow ? bottom + GAP : target.top - GAP - card.height, maxTop),
  };
}
