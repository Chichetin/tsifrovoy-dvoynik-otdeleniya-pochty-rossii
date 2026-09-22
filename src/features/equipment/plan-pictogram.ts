/**
 * Compact, familiar symbols for reading a finished 2D plan.
 *
 * The catalog's `symbol` describes geometry (rectangle, circle, triangle),
 * while this module describes what an employee recognises at a glance: a
 * counter, rack, printer or camera.  Unknown team-added types deliberately
 * fall back to no overlay — their colour, shape and caption remain truthful.
 */

import type { Id } from '../../contracts/model';

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
  return Math.max(widthPx, heightPx) >= 18 && Math.min(widthPx, heightPx) >= 10;
}
