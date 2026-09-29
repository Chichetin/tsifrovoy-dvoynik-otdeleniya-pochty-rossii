/**
 * Issue #32: coverage of client zones for every sector layer that is shown.
 *
 * The calculation itself lives in `domain/advice` (D-306) — the assistant
 * counts the same squares. Here only the choice of which layer types to count
 * and the look of a blind spot, shared by the canvas and the panel so the
 * hatch in the legend is the hatch on the plan.
 */

import type { Id, PlanDocument } from '../../contracts/model';
import { cameraCoverage, type CameraCoverage } from '../../domain/advice';
import { findLayerType } from '../../domain/catalog';

/** Hatch of a blind spot: dark red lines, distinct from the violet sectors and the pastel zones. */
export const BLIND_SPOT = {
  /** Solid colour of the hatch: the legend swatch, where lines are few and short. */
  color: '#C92A2A',
  /**
   * Lines on the plan: the same red, a little see-through, so zone names and
   * object labels under a large blind spot stay readable.
   */
  line: 'rgba(201, 42, 42, 0.6)',
  /** Faint tint under the lines, so a thin strip still reads as an area. */
  tint: 'rgba(201, 42, 42, 0.06)',
  /** Distance between hatch lines, screen px. */
  spacing_px: 9,
} as const;

/** CSS for the panel's swatch: the same diagonal hatch as on the canvas. */
export const BLIND_SPOT_SWATCH_CSS =
  `repeating-linear-gradient(45deg, ${BLIND_SPOT.color} 0 1.5px, ${BLIND_SPOT.tint} 1.5px 5px)`;

/**
 * Coverage per sector layer type with a visible layer, by layer type id.
 * Pure over the document: callers memoise it on the document's parts, so it
 * runs once per revision, not once per frame.
 */
export function visibleCoverage(plan: Pick<PlanDocument, 'layers' | 'zones' | 'objects' | 'catalog'>): Map<Id, CameraCoverage> {
  const result = new Map<Id, CameraCoverage>();
  for (const layer of plan.layers) {
    if (!layer.visible || layer.typeId === null || result.has(layer.typeId)) continue;
    const type = findLayerType(plan.catalog, layer.typeId);
    if (type === null || type.representation.kind !== 'object-field') continue;
    result.set(type.id, cameraCoverage(plan, type.representation));
  }
  return result;
}
