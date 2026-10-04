import type { PlanDocument, Point } from '../../contracts/model';
import type { EditorSession } from '../../contracts/ui';
import { footprintArea, polygonArea } from '../../domain/geometry';

/** Length of the segment between two model points and its direction. */
export type SegmentReadout = { length_m: number; angle_deg: number };

/**
 * The segment being drawn: metres and the angle from the +X axis, counter-clockwise
 * on screen (the model's Y points up). Two points at one spot give no direction.
 */
export function segmentReadout(from: Point, to: Point): SegmentReadout | null {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length_m = Math.hypot(dx, dy);
  if (length_m === 0) return null;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return { length_m, angle_deg: angle < 0 ? angle + 360 : angle };
}

/** What is selected on the plan: how many things and their floor area. */
export type SelectionReadout = { kind: 'object' | 'zone'; count: number; area_m2: number };

/**
 * A group of objects (marquee, Shift+click) wins over the single selection. Only
 * objects and zones have a floor area; a wall, an opening or the room outline
 * give no readout.
 */
export function selectionReadout(plan: PlanDocument, session: EditorSession): SelectionReadout | null {
  const group = session.selected;
  if (group !== undefined && group.size > 0) {
    const members = plan.objects.filter((object) => group.has(object.id));
    if (members.length > 0) {
      return { kind: 'object', count: members.length, area_m2: members.reduce((sum, object) => sum + footprintArea(object), 0) };
    }
  }
  const ref = session.selection;
  if (ref?.kind === 'object') {
    const object = plan.objects.find((item) => item.id === ref.id);
    if (object !== undefined) return { kind: 'object', count: 1, area_m2: footprintArea(object) };
  }
  if (ref?.kind === 'zone') {
    const zone = plan.zones.find((item) => item.id === ref.id);
    if (zone !== undefined) return { kind: 'zone', count: 1, area_m2: polygonArea(zone.polygon) };
  }
  return null;
}
