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

import type { Equipment, PlanDocument, Point, Polygon } from '../contracts/model';
import { findObjectType, findZoneType } from '../domain/catalog';
import { boundingBox, footprint, wallLength, wallPolygon } from '../domain/geometry';
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
function label(at: Point, text: string, size_m: number, fill: string, opacity: number, weight: string): string {
  return (
    `<text x="${n(at[0])}" y="${n(-at[1])}" transform="scale(1,-1)" font-family="${FONT_FAMILY}" font-weight="${weight}" ` +
    `font-size="${n(size_m)}" text-anchor="middle" dominant-baseline="middle" fill="${fill}" fill-opacity="${n(opacity)}">${esc(text)}</text>`
  );
}

// A feature module may not be imported from here (project-structure.md), so the
// canvas rule of features/layers/label-layout.ts is repeated: width = chars x size x 0.62.
type Box = { x: number; y: number; width: number; height: number };

function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

type LabelRequest = { text: string; candidates: Point[]; own: Box | null; fill: string; opacity: number; weight: string };
type PlacedLabel = { at: Point; text: string; fill: string; opacity: number; weight: string };

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
 * label, no other object and no wall; if none is free, it is not drawn.
 */
function placeAll(requests: LabelRequest[], obstacles: Box[]): PlacedLabel[] {
  const taken: Box[] = [];
  const placed: PlacedLabel[] = [];
  for (const request of requests) {
    for (const at of request.candidates) {
      const box = grow(labelBox(at, request.text), LABEL_GAP_M);
      const blocked =
        taken.some((other) => boxesOverlap(box, other)) ||
        obstacles.some((other) => other !== request.own && boxesOverlap(box, other));
      if (blocked) continue;
      taken.push(box);
      placed.push({ at, text: request.text, fill: request.fill, opacity: request.opacity, weight: request.weight });
      break;
    }
  }
  return placed;
}

function objectSymbol(object: Equipment, plan: PlanDocument, colorLayer: ObjectColorRepresentation | null): string {
  const type = findObjectType(plan.catalog, object.typeId);
  const fill = esc(colorLayer === null ? (type?.color ?? OBJECT_FALLBACK) : objectColorValue(colorLayer, object.attributes).color);
  const paint = `fill="${fill}" fill-opacity="0.9" stroke="#343A40" stroke-width="0.02"`;
  const pictogram = planPictogram(object.typeId);
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

/** Полный SVG-документ плана. */
export function renderPlanSvg(plan: PlanDocument): string {
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
  ];
  const box = boundingBox(shapes.flat());
  const minX = box.minX - MARGIN_M;
  const minY = box.minY - MARGIN_M;
  const width = box.maxX - box.minX + MARGIN_M * 2;
  const height = box.maxY - box.minY + MARGIN_M * 2;

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
  const objectLabels = placed.map((p) => label(p.at, p.text, LABEL_SIZE_M, p.fill, p.opacity, p.weight)).join('\n');


  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(width * PX_PER_M)}" height="${n(height * PX_PER_M)}" viewBox="${n(minX)} ${n(-minY - height)} ${n(width)} ${n(height)}">`,
    `<title>${esc(plan.name)}</title>`,
    `<desc>Площадь и размеры в метрах; ось Y модели направлена вверх. Сгенерировано из файла плана.</desc>`,
    // Отражение Y: модель смотрит вверх, SVG — вниз.
    `<g transform="scale(1,-1)">`,
    `<polygon points="${points(plan.room.boundary)}" fill="${ROOM_FILL}" stroke="${ROOM_STROKE}" stroke-width="0.03" data-id="${esc(plan.room.id)}"/>`,
    zones,
    walls,
    openings,
    objects,
    objectLabels,
    `</g>`,
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
