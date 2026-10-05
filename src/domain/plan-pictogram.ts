/**
 * Compact, familiar symbols for reading a finished 2D plan.
 *
 * The catalog's `symbol` describes geometry (rectangle, circle, triangle),
 * while this module describes what an employee recognises at a glance: a
 * counter, rack, printer or camera.  The catalog picks the sign by name; a
 * type with no sign of its own and none in the team catalog gets no overlay —
 * its colour, shape and caption remain truthful.
 */

import teamObjectTypes from '../../data/catalog/object-types.json';
import { PLAN_PICTOGRAM_NAMES, type Id, type ObjectType, type PlanPictogramName } from '../contracts/model';

/** The sign of a type, or null when the type has none (D-376). */
export type PlanPictogram = PlanPictogramName | null;

/** A single 24 × 24 line drawing per meaning, shared by canvas and SVG export. */
export const PLAN_PICTOGRAM_PATHS: Record<PlanPictogramName, string> = {
  workplace: 'M4 3H20V12H4Z M12 12V16 M8 16H16 M4 20H20 M6 20V16 M18 20V16',
  seat: 'M4 4V12H20V4 M4 12H20 M6 12V20 M18 12V20 M4 16H20',
  cashier: 'M3 4H21V20H3Z M3 14H21 M9 9A3 3 0 1 0 15 9A3 3 0 1 0 9 9',
  terminal: 'M7 2H17V15H7Z M10 5H14 M12 15V21 M6 21H18',
  mailbox: 'M3 5H21V19H3Z M3 5L12 13L21 5',
  display: 'M3 3H21V16H3Z M12 16V21 M7 21H17',
  printer: 'M7 3H17V8 M4 8H20V18H4Z M7 14H17V21H7Z M16 11H18',
  camera: 'M3 7H14V17H3Z M14 10L21 7V17L14 14',
  sensor: 'M12 2A10 10 0 1 0 12 22A10 10 0 1 0 12 2 M12 8A4 4 0 1 0 12 16A4 4 0 1 0 12 8',
  rack: 'M3 3H21V21H3Z M3 9H21 M3 15H21 M8 6H11 M8 12H11 M8 18H11',
  scales: 'M5 20H19 M8 7H16L19 17H5Z M12 7V12 M9 13H15',
  // Монитор и системный блок рядом: отличает компьютер от табло, у которого
  // экран один и на ножке.
  computer: 'M3 5H15V14H3Z M9 14V17 M6 17H12 M18 6H21V18H18Z',
  // Пинпад: клавиатура под экраном. Терминал очереди и оплаты стоят на стойке,
  // у них ножка, а этот лежит на кассе.
  pinpad: 'M7 3H17V21H7Z M9 6H15 M9 10H11 M13 10H15 M9 13H11 M13 13H15 M9 16H11 M13 16H15',
  alarm: 'M4 6H20V18H4Z M12 9A3 3 0 0 0 9 12V14H15V12A3 3 0 0 0 12 9 M10 16H14',
  socket: 'M12 3A9 9 0 1 0 12 21A9 9 0 1 0 12 3 M9 10V14 M15 10V14',
  ramp: 'M3 19H21 M5 19L19 8 M19 8V13 M14 8H19',
  switchboard: 'M4 4H20V20H4Z M13 7L9 13H12L11 17L15 11H12Z',
  // Решётка вентиляции — рёбра вертикальные, у стеллажа полки горизонтальные.
  hvac: 'M3 5H21V19H3Z M6 8V16 M10 8V16 M14 8V16 M18 8V16',
  heater: 'M7 4H17V20H7Z M7 8H17 M12 12L14 15A2 2 0 1 1 10 15Z',
  // Стенд навигации получил свой знак: раньше он делил «экран» с табло и
  // медиапанелью, и три разных предмета читались одинаково.
  stand: 'M4 4H20V14H4Z M12 14V20 M8 20H16 M9 8H15 M9 11H13',
};

const SIGN_NAMES: ReadonlySet<string> = new Set(PLAN_PICTOGRAM_NAMES);

/**
 * Signs of the team catalog by type id. A plan file carries its own catalog,
 * and a plan saved before D-376 has no `pictogram` there.
 */
const TEAM_PICTOGRAMS: ReadonlyMap<Id, PlanPictogramName> = new Map(
  (teamObjectTypes as { id: Id; pictogram?: string }[]).flatMap((type) =>
    type.pictogram !== undefined && SIGN_NAMES.has(type.pictogram)
      ? [[type.id, type.pictogram as PlanPictogramName] as const]
      : [],
  ),
);

/**
 * An equipment type's readable 2D-plan symbol (D-376). The type's own
 * `pictogram` wins; without it the team catalog's type with the same id gives
 * the sign; otherwise — and with no type at all — there is no sign.
 */
export function planPictogram(type: Pick<ObjectType, 'id' | 'pictogram'> | null | undefined): PlanPictogram {
  if (type === null || type === undefined) return null;
  return type.pictogram ?? TEAM_PICTOGRAMS.get(type.id) ?? null;
}

/** Меньше этого знак превращается в кляксу; таков же пол у SVG-экспорта (0,18 м на 100 px/м). */
export const PLAN_PICTOGRAM_MIN_PX = 11;

/**
 * Ниже этого объект и сам не читается на экране: полсотни знаков поверх
 * неразличимых точек — шум, а не наглядность. Порог проверен по датчику
 * пожарной сигнализации (0,12 м — 4,8 px во «Вписать» на экране 1280).
 */
const PLAN_PICTOGRAM_MIN_OBJECT_PX = 4;

/** Do not turn a zoomed-out, dense plan into a layer of visual noise. */
export function isPlanPictogramVisible(widthPx: number, heightPx: number): boolean {
  return Math.max(widthPx, heightPx) >= PLAN_PICTOGRAM_MIN_OBJECT_PX;
}

/**
 * Размер знака в пикселях. Крупный объект несёт знак по своему следу, мелкий —
 * постоянного размера: камера, датчик дыма, пинпад и розетка меньше самого
 * знака, и на планах их обозначают символом, а не масштабной фигурой. Ровно
 * так же поступает экспорт (`plan-svg`), поэтому экран и SVG совпадают.
 */
export function planPictogramSize(widthPx: number, heightPx: number): number {
  return Math.min(20, Math.max(PLAN_PICTOGRAM_MIN_PX, Math.min(widthPx, heightPx) * 0.78));
}

/**
 * Знак мелкого объекта выходит за его след, и белые линии оказываются на полу,
 * где их не видно. Такому знаку нужна подложка цвета объекта.
 */
export function planPictogramNeedsBackdrop(widthPx: number, heightPx: number): boolean {
  return planPictogramSize(widthPx, heightPx) > Math.min(widthPx, heightPx);
}
