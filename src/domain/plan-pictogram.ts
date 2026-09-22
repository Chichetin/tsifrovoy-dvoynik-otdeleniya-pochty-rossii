/**
 * Compact, familiar symbols for reading a finished 2D plan.
 *
 * The catalog's `symbol` describes geometry (rectangle, circle, triangle),
 * while this module describes what an employee recognises at a glance: a
 * counter, rack, printer or camera.  Unknown team-added types deliberately
 * fall back to no overlay — their colour, shape and caption remain truthful.
 */

import type { Id } from '../contracts/model';

export type PlanPictogram =
  | 'workplace'
  | 'seat'
  | 'cashier'
  | 'terminal'
  | 'mailbox'
  | 'display'
  | 'printer'
  | 'camera'
  | 'sensor'
  | 'rack'
  | 'scales'
  | null;

/** A single 24 × 24 line drawing per meaning, shared by canvas and SVG export. */
export const PLAN_PICTOGRAM_PATHS: Record<Exclude<PlanPictogram, null>, string> = {
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
};

/** An equipment type's readable 2D-plan symbol. */
export function planPictogram(typeId: Id): PlanPictogram {
  switch (typeId) {
    case 'ot_workplace':
      return 'workplace';
    case 'ot_chair':
    case 'ot_bench':
      return 'seat';
    case 'ot_cashier_window':
      return 'cashier';
    case 'ot_payment_terminal':
    case 'ot_queue_terminal':
      return 'terminal';
    case 'ot_mailbox':
      return 'mailbox';
    case 'ot_info_display':
    case 'ot_media_panel':
    case 'ot_info_stand':
      return 'display';
    case 'ot_printer':
    case 'ot_label_printer':
      return 'printer';
    case 'ot_camera':
      return 'camera';
    case 'ot_fire_sensor':
      return 'sensor';
    case 'ot_parcel_rack':
    case 'ot_goods_rack':
      return 'rack';
    case 'ot_scales':
      return 'scales';
    default:
      return null;
  }
}

/** Do not turn a zoomed-out, dense plan into a layer of visual noise. */
export function isPlanPictogramVisible(widthPx: number, heightPx: number): boolean {
  return Math.max(widthPx, heightPx) >= 20 && Math.min(widthPx, heightPx) >= 16;
}
