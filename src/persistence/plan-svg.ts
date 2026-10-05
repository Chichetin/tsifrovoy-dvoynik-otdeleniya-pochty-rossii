/**
 * Картинка плана для согласования: SVG из документа, без Konva и без экрана.
 *
 * Организаторы назвали SVG самым подходящим форматом для 2D (D-061); у нас это
 * не формат хранения и не движок редактора, а выгрузка «показать руководству».
 * Рисуется из тех же данных, что и холст: контур помещения, зоны цветом типа
 * из справочника, стены, проёмы, объекты по `size_m`, символу и цвету типа.
 * Ось Y модели смотрит вверх, а в SVG — вниз; отражение делает `viewBox` и
 * `transform`, так что координаты метров пишутся как есть.
 *
 * Чистая функция: тот же документ — тот же файл.
 */

import type { Attributes, Equipment, Id, LayerType, PlanDocument, Point, Polygon, Severity, Zone } from '../contracts/model';
import { cameraCoverage } from '../domain/advice';
import { findLayerType, findObjectType, findZoneType } from '../domain/catalog';
import { boundingBox, footprint, viewSector, wallLength, wallPolygon } from '../domain/geometry';
import { heatColor } from '../domain/heat-color';
import { formatShort, NBSP } from '../domain/number-format';
import { validatePlan } from '../domain/validation';
import { planPictogram, PLAN_PICTOGRAM_PATHS } from '../domain/plan-pictogram';
import { activeObjectColor, objectColorValue, type ObjectColorRepresentation } from '../domain/object-color';

/** Пикселей на метр в файле. Выбрано так, чтобы 15-метровый зал был ~1500 px. */
const PX_PER_M = 100;
const MARGIN_M = 0.5;
const ROOM_FILL = '#F8F9FA';
const ROOM_STROKE = '#212529';
const WALL_FILL = '#495057';
const OPENING_STROKE = '#FFFFFF';
const ZONE_FALLBACK = '#E9ECEF';
const OBJECT_FALLBACK = '#868E96';
const LABEL_FILL = '#212529';
const ZONE_LABEL_FILL = '#495057';
/** Same stack as the interface (`--font-ui` in styles.css). */
const FONT_FAMILY = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', 'Liberation Sans', Arial, sans-serif";
/** One size for object labels and zone names: a zone name must not outweigh equipment. */
const LABEL_SIZE_M = 0.16;
/** Gap kept between two drawn labels, metres. */
const LABEL_GAP_M = 0.03;
/** Objects smaller than this (a sensor, a socket) get no label on the picture. */
const MIN_LABELLED_AREA_M2 = 0.15;

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

function n(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function points(polygon: Polygon): string {
  return polygon.map(([x, y]) => `${n(x)},${n(y)}`).join(' ');
}

function centreOf(polygon: Polygon): Point {
  const box = boundingBox(polygon);
  return [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2];
}

/** Текст подписи: Y отражён обратно, иначе буквы стоят вверх ногами. */
function label(at: Point, text: string, size_m: number, fill: string, opacity: number, weight: string, halo = false): string {
  // A white outline under the letters keeps a layer value readable on its own heat colour.
  const outline = halo ? ` stroke="#FFFFFF" stroke-width="${n(size_m * 0.25)}" paint-order="stroke"` : '';
  return (
    `<text x="${n(at[0])}" y="${n(-at[1])}" transform="scale(1,-1)" font-family="${FONT_FAMILY}" font-weight="${weight}"${outline} ` +
    `font-size="${n(size_m)}" text-anchor="middle" dominant-baseline="middle" fill="${fill}" fill-opacity="${n(opacity)}">${esc(text)}</text>`
  );
}

// A feature module may not be imported from here (project-structure.md), so the
// canvas rule of features/layers/label-layout.ts is repeated: width = chars x size x 0.62.
type Box = { x: number; y: number; width: number; height: number };

function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

type LabelRequest = {
  text: string;
  candidates: Point[];
  own: Box | null;
  fill: string;
  opacity: number;
  weight: string;
  /** Drawn at the first candidate when no spot is free: a layer value is never dropped, as on the canvas. */
  always?: boolean;
};
type PlacedLabel = { at: Point; text: string; fill: string; opacity: number; weight: string; halo: boolean };

/** Box of a centred one-line label in model metres (Y up). Width estimate is the canvas one. */
function labelBox(at: Point, text: string): Box {
  const width = text.length * LABEL_SIZE_M * 0.62 + 0.08;
  const height = LABEL_SIZE_M * 1.25;
  return { x: at[0] - width / 2, y: at[1] - height / 2, width, height };
}

function grow(box: Box, by: number): Box {
  return { x: box.x - by, y: box.y - by, width: box.width + 2 * by, height: box.height + 2 * by };
}

function boxOf(polygon: Polygon): Box {
  const b = boundingBox(polygon);
  return { x: b.minX, y: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY };
}

/**
 * Greedy, in priority order (object labels first, then zone names), like the
 * canvas: a label is drawn at the first candidate spot that touches no drawn
 * label, no other object and no wall; if none is free, it is not drawn —
 * except a layer value (`always`), which takes its first spot.
 */
function placeAll(requests: LabelRequest[], obstacles: Box[]): PlacedLabel[] {
  const taken: Box[] = [];
  const placed: PlacedLabel[] = [];
  for (const request of requests) {
    const free = request.candidates.find((at) => {
      const box = grow(labelBox(at, request.text), LABEL_GAP_M);
      return !(
        taken.some((other) => boxesOverlap(box, other)) ||
        obstacles.some((other) => other !== request.own && boxesOverlap(box, other))
      );
    });
    const at = free ?? (request.always === true ? request.candidates[0] : undefined);
    if (at === undefined) continue;
    taken.push(grow(labelBox(at, request.text), LABEL_GAP_M));
    placed.push({ at, text: request.text, fill: request.fill, opacity: request.opacity, weight: request.weight, halo: request.always === true });
  }
  return placed;
}

function objectSymbol(object: Equipment, plan: PlanDocument, colorLayer: ObjectColorRepresentation | null): string {
  const type = findObjectType(plan.catalog, object.typeId);
  const fill = esc(colorLayer === null ? (type?.color ?? OBJECT_FALLBACK) : objectColorValue(colorLayer, object.attributes).color);
  const paint = `fill="${fill}" fill-opacity="0.9" stroke="#343A40" stroke-width="0.02"`;
  const pictogram = planPictogram(type);
  // Export uses a fixed 100 px/m scale. Keep a tiny camera distinguishable,
  // but cap the drawn icon so a large counter does not become a giant glyph.
  const iconSize = Math.min(0.25, Math.max(0.18, Math.min(...object.size_m) * 0.6));
  const iconScale = iconSize / 24;
  const icon = pictogram === null ? '' : (
    `<g data-pictogram="${pictogram}" transform="translate(${n(object.position[0])} ${n(object.position[1])}) scale(${n(iconScale)} ${n(-iconScale)}) translate(-12 -12)">` +
    `<path d="${PLAN_PICTOGRAM_PATHS[pictogram]}" fill="none" stroke="#FFFFFF" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</g>`
  );
  // The same ring the checks and the canvas use (D-277), already turned and
  // placed in world metres; the outer transform takes care of Y.
  return `<g data-id="${esc(object.id)}"><polygon points="${points(footprint(object))}" ${paint}/>${icon}</g>`;
}

// ---- Screen overlays (#216): information layers, finding markers, legend ----
// The canvas draws them in features/layers and features/validation; a feature
// may not be imported from here, so the look is repeated: same colours, same
// opacities, same legend text.

const LEGEND_FILL = '#212529';
const LEGEND_SIZE_M = 0.16;
const LEGEND_ROW_M = 0.3;
const MARKER_R_M = 0.12;
const MARKER_HALO = '#FFFFFF';
/** Same as HIGHLIGHT_COLORS in features/validation. */
const SEVERITY_COLORS: Readonly<Record<Severity, string>> = { error: '#C92A2A', warning: '#E8590C' };
/** Same as BLIND_SPOT in features/layers/coverage.ts. */
const BLIND_COLOR = '#C92A2A';
const MAX_DEPTH = 64;

function numberAttribute(attributes: Attributes, key: string): number | null {
  const value = attributes[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** As `formatValue` of the canvas legend: decimal comma, non-breaking space before the unit. */
function formatValue(value: number, unit: string): string {
  const text = formatShort(value);
  return unit === '' ? text : `${text}${NBSP}${unit}`;
}

function textWidth(text: string, size_m: number): number {
  return text.length * size_m * 0.62;
}

/** The colour that stands for the layer in its value labels, as on the canvas. */
function layerColor(type: LayerType): string {
  const representation = type.representation;
  if (representation.kind === 'zone-heat') return representation.colors[1];
  if (representation.kind === 'objects') return LABEL_FILL;
  if (representation.kind === 'object-color') return representation.values[0]?.color ?? LABEL_FILL;
  return representation.color;
}

/**
 * Heat areas: the deepest zone with a value paints each point (D-138). A zone's
 * path holds its own ring and the rings of its nearest painted descendants;
 * `evenodd` turns those into holes.
 */
function heatPaths(zones: Zone[], attribute: string): { zoneId: Id; value: number; d: string }[] {
  const byId = new Map(zones.map((zone) => [zone.id, zone]));
  const values = new Map<Id, number>();
  for (const zone of zones) {
    const value = numberAttribute(zone.attributes, attribute);
    if (value !== null) values.set(zone.id, value);
  }
  const paintedParent = (zone: Zone): Id | null => {
    let current = zone.parentId;
    for (let step = 0; step < MAX_DEPTH && current !== null; step += 1) {
      if (values.has(current)) return current;
      current = byId.get(current)?.parentId ?? null;
    }
    return null;
  };
  const ring = (polygon: Polygon): string => `M${polygon.map(([x, y]) => `${n(x)},${n(y)}`).join('L')}Z`;
  return zones.flatMap((zone) => {
    const value = values.get(zone.id);
    if (value === undefined || zone.polygon.length < 3) return [];
    const holes = zones.filter((other) => values.has(other.id) && other.polygon.length >= 3 && paintedParent(other) === zone.id);
    return [{ zoneId: zone.id, value, d: [zone.polygon, ...holes.map((hole) => hole.polygon)].map(ring).join('') }];
  });
}

type Marker = { key: string; count: number; severity: Severity; at: Point };

/** One marker per entity with findings, top right of its shape, as `issueMarkers` on the canvas. */
function findingMarkers(plan: PlanDocument): Marker[] {
  const byKey = new Map<string, Marker>();
  for (const issue of validatePlan(plan)) {
    const ref = issue.refs[0];
    if (ref === undefined || issue.polygon === undefined || issue.polygon.length < 3) continue;
    const key = `${ref.kind}:${ref.id}`;
    const known = byKey.get(key);
    if (known !== undefined) {
      known.count += 1;
      if (issue.severity === 'error') known.severity = 'error';
      continue;
    }
    const box = boundingBox(issue.polygon);
    byKey.set(key, { key, count: 1, severity: issue.severity, at: [box.maxX + MARKER_R_M, box.maxY + MARKER_R_M] });
  }
  // Markers of neighbouring shapes can land on one spot: push a later one down.
  const placed: Point[] = [];
  for (const marker of byKey.values()) {
    while (placed.some((other) => Math.hypot(other[0] - marker.at[0], other[1] - marker.at[1]) < 2 * MARKER_R_M)) {
      marker.at = [marker.at[0], marker.at[1] - 2 * MARKER_R_M - 0.02];
    }
    placed.push(marker.at);
  }
  return [...byKey.values()];
}

/** One legend row: swatch markup at (x, y-centre) and the text after it. */
type LegendRow = { swatch: (x: number, y: number) => string; swatchWidth: number; text: string };

type Overlay = {
  defs: string[];
  heat: string[];
  sectors: string[];
  values: LabelRequest[];
  markers: Marker[];
  legend: LegendRow[];
};

/** What the canvas shows over the plan: visible information layers and finding markers. */
function planOverlay(plan: PlanDocument, visibleZones: Zone[]): Overlay {
  const overlay: Overlay = { defs: [], heat: [], sectors: [], values: [], markers: findingMarkers(plan), legend: [] };
  const rect = (fill: string) => (x: number, y: number): string =>
    `<rect x="${n(x)}" y="${n(y - 0.08)}" width="0.16" height="0.16" fill="${esc(fill)}"/>`;
  const active = plan.layers
    .filter((layer) => layer.visible)
    .slice()
    .sort((a, b) => a.order - b.order)
    .flatMap((layer) => {
      const type = findLayerType(plan.catalog, layer.typeId);
      return type === null || type.representation.kind === 'objects' ? [] : [{ id: layer.id, type }];
    });

  for (const { id, type } of active) {
    const representation = type.representation;
    if (representation.kind === 'zone-heat' || representation.kind === 'zone-count') {
      const color = layerColor(type);
      for (const zone of visibleZones) {
        const value = numberAttribute(zone.attributes, representation.attribute);
        if (value === null) continue;
        const c = centreOf(zone.polygon);
        overlay.values.push({
          text: formatValue(value, representation.unit),
          candidates: [[c[0], c[1] - 0.22], [c[0], c[1] - 0.42], [c[0], c[1] + 0.22], [c[0], c[1] - 0.62], [c[0], c[1] + 0.42]],
          own: null,
          fill: color,
          opacity: 1,
          weight: 'bold',
          always: true,
        });
      }
      if (representation.kind === 'zone-count') {
        overlay.legend.push({ swatch: rect(representation.color), swatchWidth: 0.16, text: `${type.label}: метка в зоне — ${representation.unit}` });
        continue;
      }
      for (const region of heatPaths(plan.zones, representation.attribute)) {
        const fill = heatColor(representation.colors, region.value, representation.max);
        overlay.heat.push(`<path d="${region.d}" fill="${esc(fill)}" fill-opacity="0.7" fill-rule="evenodd" data-layer="${esc(id)}" data-zone="${esc(region.zoneId)}"/>`);
      }
      const gradient = `legend-scale-${overlay.defs.length}`;
      overlay.defs.push(
        `<linearGradient id="${gradient}"><stop offset="0" stop-color="${esc(representation.colors[0])}"/><stop offset="1" stop-color="${esc(representation.colors[1])}"/></linearGradient>`,
      );
      overlay.legend.push({
        swatch: (x, y) => `<rect x="${n(x)}" y="${n(y - 0.06)}" width="0.4" height="0.12" fill="url(#${gradient})"/>`,
        swatchWidth: 0.4,
        text: `${type.label}: ${formatValue(0, representation.unit)} … ${formatValue(representation.max, representation.unit)}`,
      });
      continue;
    }
    if (representation.kind === 'object-color') {
      // Objects are already painted by this layer (`activeObjectColor`); only the legend is added.
      const values = representation.values;
      overlay.legend.push({
        swatch: (x, y) => values.map((value, index) => rect(value.color)(x + index * 0.2, y)).join(''),
        swatchWidth: values.length * 0.2 - 0.04,
        text: `${type.label}: ${values.map((value) => value.label).join(', ')}`,
      });
      continue;
    }
    if (representation.kind !== 'object-field') continue;
    const types = new Set(representation.objectTypeIds);
    for (const object of plan.objects) {
      if (!types.has(object.typeId)) continue;
      const angle = numberAttribute(object.attributes, representation.angleAttribute) ?? representation.angle_deg;
      const range = numberAttribute(object.attributes, representation.rangeAttribute) ?? representation.range_m;
      const sector = viewSector(object.position, object.rotation_deg, angle, range);
      const color = esc(representation.color);
      overlay.sectors.push(`<polygon points="${points(sector)}" fill="${color}" fill-opacity="0.22" stroke="${color}" stroke-width="0.01" data-layer="${esc(id)}" data-sector="${esc(object.id)}"/>`);
    }
    overlay.legend.push({
      swatch: rect(representation.color),
      swatchWidth: 0.16,
      text: `${type.label}: сектор обзора; без атрибутов камеры — ${representation.angle_deg}°, ${formatValue(representation.range_m, 'м')}`,
    });
    const coverage = cameraCoverage(plan, representation);
    if (coverage.total.percent === null) continue;
    if (overlay.defs.every((def) => !def.includes('id="blind-hatch"'))) {
      overlay.defs.push(
        `<pattern id="blind-hatch" patternUnits="userSpaceOnUse" width="0.09" height="0.09" patternTransform="rotate(45)">` +
          `<rect width="0.09" height="0.09" fill="${BLIND_COLOR}" fill-opacity="0.06"/>` +
          `<line x1="0" y1="0" x2="0" y2="0.09" stroke="${BLIND_COLOR}" stroke-opacity="0.6" stroke-width="0.015"/></pattern>`,
      );
    }
    for (const strip of coverage.blind) {
      overlay.sectors.push(`<rect x="${n(strip.x)}" y="${n(strip.y)}" width="${n(strip.width)}" height="${n(strip.height)}" fill="url(#blind-hatch)" data-blind="${esc(id)}"/>`);
    }
    overlay.legend.push({
      swatch: (x, y) => `<rect x="${n(x)}" y="${n(y - 0.08)}" width="0.16" height="0.16" fill="url(#blind-hatch)" stroke="${BLIND_COLOR}" stroke-width="0.01"/>`,
      swatchWidth: 0.16,
      text: `Слепые пятна клиентских зон · видно ${formatValue(coverage.total.percent, '%')}`,
    });
  }

  if (overlay.markers.length > 0) {
    overlay.legend.push({
      swatch: (x, y) =>
        `<circle cx="${n(x + 0.08)}" cy="${n(y)}" r="0.08" fill="${SEVERITY_COLORS.error}"/>` +
        `<circle cx="${n(x + 0.28)}" cy="${n(y)}" r="0.08" fill="${SEVERITY_COLORS.warning}"/>`,
      swatchWidth: 0.36,
      text: `Находки проверки: мест на плане — ${overlay.markers.length}; число — находок у места; красный — ошибка, оранжевый — предупреждение`,
    });
  }
  return overlay;
}

function markerSvg(marker: Marker): string {
  const [x, y] = marker.at;
  return (
    `<g data-marker="${esc(marker.key)}"><circle cx="${n(x)}" cy="${n(y)}" r="${MARKER_R_M}" fill="${SEVERITY_COLORS[marker.severity]}" stroke="${MARKER_HALO}" stroke-width="0.025"/>` +
    `${label(marker.at, String(marker.count), 0.14, MARKER_HALO, 1, 'bold')}</g>`
  );
}

export type PlanSvgOptions = {
  /**
   * Add what the canvas shows over the plan (#216): visible information layers
   * with a legend under the plan and finding markers. The PNG and SVG export
   * take it; the print page has its own legend and does not.
   */
  overlays?: boolean;
};

/** Полный SVG-документ плана. */
export function renderPlanSvg(plan: PlanDocument, options: PlanSvgOptions = {}): string {
  const visibleLayers = new Set(
    plan.layers.filter((layer) => layer.visible).map((layer) => layer.id),
  );
  const visibleZones = plan.zones.filter((zone) => visibleLayers.has(zone.layerId));
  const visibleObjects = plan.objects.filter((object) => visibleLayers.has(object.layerId));
  const objectBoxes = visibleObjects.map((object) => boxOf(footprint(object)));
  const requests: LabelRequest[] = [];
  visibleObjects.forEach((object, index) => {
    if (object.size_m[0] * object.size_m[1] < MIN_LABELLED_AREA_M2) return;
    const box = objectBoxes[index];
    if (box === undefined) return;
    const x = object.position[0];
    requests.push({
      text: object.label,
      candidates: [
        [x, box.y - 0.15],
        [x, box.y + box.height + 0.15],
        [box.x + box.width + 0.1 + labelBox([0, 0], object.label).width / 2, box.y + box.height / 2],
        [box.x - 0.1 - labelBox([0, 0], object.label).width / 2, box.y + box.height / 2],
      ],
      own: box,
      fill: LABEL_FILL,
      opacity: 1,
      weight: 'normal',
    });
  });
  for (const zone of visibleZones) {
    const zb = boxOf(zone.polygon);
    const c = centreOf(zone.polygon);
    requests.push({
      text: zone.name,
      candidates: [c, [c[0], zb.y + zb.height - 0.15], [c[0], zb.y + 0.15]],
      own: null,
      fill: ZONE_LABEL_FILL,
      opacity: 0.85,
      weight: 'bold',
    });
  }
  const overlay = options.overlays === true ? planOverlay(plan, visibleZones) : null;
  // Layer values go after zone names: a name keeps its place, a value moves around it.
  if (overlay !== null) requests.push(...overlay.values);
  const placed = placeAll(requests, [...objectBoxes, ...plan.walls.map((wall) => boxOf(wallPolygon(wall, plan.walls, plan.openings)))]);

  // Everything drawn takes part in the extent: a wall outside the outline
  // must not be cut off, and neither may a label at the edge.
  const shapes: Polygon[] = [
    plan.room.boundary,
    ...visibleZones.map((z) => z.polygon),
    ...plan.walls.map((wall) => wallPolygon(wall, plan.walls, plan.openings)),
    ...visibleObjects.map(footprint),
    ...placed.map((p) => {
      const box = labelBox(p.at, p.text);
      return [[box.x, box.y], [box.x + box.width, box.y + box.height]] as Polygon;
    }),
    ...(overlay?.markers ?? []).map(({ at }) =>
      [[at[0] - MARKER_R_M, at[1] - MARKER_R_M], [at[0] + MARKER_R_M, at[1] + MARKER_R_M]] as Polygon,
    ),
  ];
  const box = boundingBox(shapes.flat());
  const minX = box.minX - MARGIN_M;
  const minY = box.minY - MARGIN_M;
  const planHeight = box.maxY - box.minY + MARGIN_M * 2;
  // Legend under the plan, outside the Y flip: rows go down from the plan's bottom edge.
  const legendRows = overlay?.legend ?? [];
  const legendTop = -minY;
  const legendX = minX + MARGIN_M;
  const legendWidth = Math.max(0, ...legendRows.map((row) => row.swatchWidth + 0.12 + textWidth(row.text, LEGEND_SIZE_M)));
  const width = Math.max(box.maxX - box.minX + MARGIN_M * 2, legendWidth + MARGIN_M * 2);
  const height = planHeight + (legendRows.length === 0 ? 0 : legendRows.length * LEGEND_ROW_M + MARGIN_M / 2);
  const legend = legendRows
    .map((row, index) => {
      const y = legendTop + LEGEND_ROW_M / 2 + index * LEGEND_ROW_M;
      const textX = legendX + row.swatchWidth + 0.12;
      return (
        row.swatch(legendX, y) +
        `<text x="${n(textX)}" y="${n(y)}" font-family="${FONT_FAMILY}" font-size="${n(LEGEND_SIZE_M)}" dominant-baseline="middle" fill="${LEGEND_FILL}">${esc(row.text)}</text>`
      );
    })
    .join('\n');

  const zones = visibleZones
    .slice()
    .sort((a, b) => (a.parentId === null ? 0 : 1) - (b.parentId === null ? 0 : 1))
    .map((zone) => {
      const fill = esc(findZoneType(plan.catalog, zone.typeId)?.color ?? ZONE_FALLBACK);
      return `<polygon points="${points(zone.polygon)}" fill="${fill}" fill-opacity="0.75" stroke="#ADB5BD" stroke-width="0.02" data-id="${esc(zone.id)}"/>`;
    })
    .join('\n');

  const walls = plan.walls
    .map((wall) => `<polygon points="${points(wallPolygon(wall, plan.walls, plan.openings))}" fill="${WALL_FILL}" data-id="${esc(wall.id)}"/>`)
    .join('\n');

  const openings = plan.openings
    .map((opening) => {
      const wall = plan.walls.find((w) => w.id === opening.wallId);
      if (wall === undefined) return '';
      const length = wallLength(wall);
      if (length === 0) return '';
      const ux = (wall.to[0] - wall.from[0]) / length;
      const uy = (wall.to[1] - wall.from[1]) / length;
      const a: Point = [wall.from[0] + ux * opening.offset_m, wall.from[1] + uy * opening.offset_m];
      const b: Point = [a[0] + ux * opening.width_m, a[1] + uy * opening.width_m];
      return `<line x1="${n(a[0])}" y1="${n(a[1])}" x2="${n(b[0])}" y2="${n(b[1])}" stroke="${OPENING_STROKE}" stroke-width="${n(Math.max(0.06, wall.thickness_m))}" data-id="${esc(opening.id)}"/>`;
    })
    .join('\n');

  const colorLayer = activeObjectColor(plan);
  const objects = visibleObjects.map((object) => objectSymbol(object, plan, colorLayer)).join('\n');
  const objectLabels = placed.map((p) => label(p.at, p.text, LABEL_SIZE_M, p.fill, p.opacity, p.weight, p.halo)).join('\n');


  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(width * PX_PER_M)}" height="${n(height * PX_PER_M)}" viewBox="${n(minX)} ${n(-minY - planHeight)} ${n(width)} ${n(height)}">`,
    `<title>${esc(plan.name)}</title>`,
    `<desc>Площадь и размеры в метрах; ось Y модели направлена вверх. Сгенерировано из файла плана.</desc>`,
    overlay === null || overlay.defs.length === 0 ? '' : `<defs>${overlay.defs.join('')}</defs>`,
    // Отражение Y: модель смотрит вверх, SVG — вниз.
    `<g transform="scale(1,-1)">`,
    `<polygon points="${points(plan.room.boundary)}" fill="${ROOM_FILL}" stroke="${ROOM_STROKE}" stroke-width="0.03" data-id="${esc(plan.room.id)}"/>`,
    zones,
    (overlay?.heat ?? []).join('\n'),
    walls,
    openings,
    objects,
    (overlay?.sectors ?? []).join('\n'),
    objectLabels,
    (overlay?.markers ?? []).map(markerSvg).join('\n'),
    `</g>`,
    legend,
    `</svg>`,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * Имя файла из названия плана: буквы и цифры остаются, остальное — дефис.
 * Одно правило для `.json`, `.svg` и `.png`, чтобы план и его картинки лежали рядом.
 */
export function planFileName(plan: PlanDocument, extension: 'json' | 'svg' | 'png'): string {
  const stem = plan.name.trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  return `${stem === '' ? 'plan' : stem}.${extension}`;
}

/** Имя файла картинки — как у файла плана, но `.svg`. */
export function svgFileName(plan: PlanDocument): string {
  return planFileName(plan, 'svg');
}
