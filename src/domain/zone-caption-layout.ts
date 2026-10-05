import type { PlanDocument, Polygon, Viewport } from '../contracts/model';
import { boundingBox, contains, footprint, modelToScreen } from './geometry';
import { CAPTION_ICON_SPACE_PX, LABEL_LINE_PX, objectLabel } from './object-label';
import { isPlanPictogramVisible, planPictogram, planPictogramSize } from './plan-pictogram';

export type CaptionBox = { x: number; y: number; width: number; height: number };
export const ZONE_CAPTION_FONT = 13;
export const ZONE_CAPTION_WIDTH = 118;
export const ZONE_CAPTION_SPACING = 0.4;

function overlapArea(a: CaptionBox, b: CaptionBox): number {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}

/** Bounded two-dimensional search, including concave zones. A crowded zone
 * keeps its name in the least obstructed candidate, rather than losing it. */
export function placeZoneCaption(polygon: Polygon, width: number, height: number, obstacles: readonly CaptionBox[]): CaptionBox {
  const bounds = boundingBox(polygon);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const fallback = { x: cx - width / 2, y: cy - height / 2, width, height };
  let best = fallback;
  let bestArea = Infinity;
  let bestDistance = Infinity;
  const lowX = bounds.minX + 4;
  const lowY = bounds.minY + 4;
  const spanX = bounds.maxX - 4 - width - lowX;
  const spanY = bounds.maxY - 4 - height - lowY;
  if (spanX < 0 || spanY < 0) return fallback;
  const boundsBox = { x: bounds.minX, y: bounds.minY, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY };
  const nearby = obstacles.filter((box) => overlapArea(boundsBox, box) > 0);
  const positions = (low: number, span: number, size: number, axis: 'x' | 'y'): number[] => {
    const values = Array.from({ length: 9 }, (_, i) => low + i * span / 8);
    for (const obstacle of nearby) {
      values.push(obstacle[axis] - size - 3, obstacle[axis] + (axis === 'x' ? obstacle.width : obstacle.height) + 3);
    }
    const centre = low + span / 2;
    return [...new Set(values)].filter((value) => value >= low && value <= low + span)
      .sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre)).slice(0, 24);
  };
  for (const x of positions(lowX, spanX, width, 'x')) {
    for (const y of positions(lowY, spanY, height, 'y')) {
      const box = { x, y, width, height };
      const ring: Polygon = [[box.x, box.y], [box.x + width, box.y],
        [box.x + width, box.y + height], [box.x, box.y + height]];
      if (!contains(polygon, ring)) continue;
      const grown = { x: box.x - 3, y: box.y - 3, width: width + 6, height: height + 6 };
      const area = nearby.reduce((sum, obstacle) => sum + overlapArea(grown, obstacle), 0);
      const distance = (box.x + width / 2 - cx) ** 2 + (box.y + height / 2 - cy) ** 2;
      if (area < bestArea || (area === bestArea && distance < bestDistance)) {
        best = box; bestArea = area; bestDistance = distance;
      }
    }
  }
  return best;
}

/** Word-wrap estimate with explicit line breaks. Glyph clearance belongs to
 * the placement gap; the renderer keeps automatic height so estimates never crop text. */
function captionHeight(text: string, width: number): number {
  const charWidth = ZONE_CAPTION_FONT * 0.7 + ZONE_CAPTION_SPACING;
  const capacity = Math.max(1, Math.floor(width / charWidth));
  let lines = 0;
  for (const paragraph of text.split('\n')) {
    lines += 1;
    let used = 0;
    for (const word of paragraph.split(/\s+/u)) {
      if (used > 0 && used + 1 + word.length <= capacity) used += word.length + 1;
      else {
        if (used > 0) lines += 1;
        lines += Math.max(0, Math.ceil(word.length / capacity) - 1);
        used = Math.max(0, ((word.length - 1) % capacity) + 1);
      }
    }
  }
  return lines * ZONE_CAPTION_FONT;
}

/** Shared by zone names and informational layers; no changes to the document. */
export function zoneCaptionBoxes(plan: PlanDocument, viewport: Viewport): Map<string, CaptionBox> {
  const visible = new Set(plan.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  const obstacles: CaptionBox[] = [];
  const types = new Map(plan.catalog.objectTypes.map((type) => [type.id, type]));
  for (const object of plan.objects) {
    if (!visible.has(object.layerId)) continue;
    const bounds = boundingBox(footprint(object).map((point) => modelToScreen(point, viewport)));
    obstacles.push({ x: bounds.minX, y: bounds.minY, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY });
    const kind = planPictogram(types.get(object.typeId));
    const label = objectLabel(object, viewport, kind === null ? 0 : CAPTION_ICON_SPACE_PX);
    if (label === null) {
      const [w, h] = object.size_m.map((size) => size * viewport.scale);
      if (kind !== null && isPlanPictogramVisible(w!, h!)) {
        const diameter = planPictogramSize(w!, h!) * 1.24 + 0.5;
        const [x, y] = modelToScreen(object.position, viewport);
        obstacles.push({ x: x - diameter / 2, y: y - diameter / 2, width: diameter, height: diameter });
      }
      continue;
    }
    const height = Math.max(label.lines * LABEL_LINE_PX + 2, 22);
    const angle = label.rotation * Math.PI / 180;
    const width = Math.abs(Math.cos(angle)) * label.width + Math.abs(Math.sin(angle)) * height;
    const rotatedHeight = Math.abs(Math.sin(angle)) * label.width + Math.abs(Math.cos(angle)) * height;
    obstacles.push({ x: label.x - width / 2, y: label.y - rotatedHeight / 2, width, height: rotatedHeight });
  }
  const result = new Map<string, CaptionBox>();
  for (const zone of plan.zones) {
    if (!visible.has(zone.layerId)) continue;
    const polygon = zone.polygon.map((point) => modelToScreen(point, viewport));
    const bounds = boundingBox(polygon);
    const width = Math.min(ZONE_CAPTION_WIDTH, Math.max(44, bounds.maxX - bounds.minX - 16));
    const box = placeZoneCaption(polygon, width, captionHeight(zone.name.toLocaleUpperCase('ru'), width), obstacles);
    result.set(zone.id, box);
    obstacles.push(box);
  }
  return result;
}
