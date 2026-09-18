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
 * Чистая функция: тот же документ — тот же файл, и это проверяется тестом.
 */

import type { Equipment, PlanDocument, Point, Polygon } from '../contracts/model';
import { findObjectType, findZoneType } from '../domain/catalog';
import { boundingBox, footprint, wallPolygon } from '../domain/geometry';

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
function label(at: Point, text: string, size_m: number, anchor = 'middle'): string {
  return (
    `<text x="${n(at[0])}" y="${n(-at[1])}" transform="scale(1,-1)" ` +
    `font-size="${n(size_m)}" text-anchor="${anchor}" dominant-baseline="middle" fill="${LABEL_FILL}">${esc(text)}</text>`
  );
}

function objectSymbol(object: Equipment, plan: PlanDocument): string {
  const type = findObjectType(plan.catalog, object.typeId);
  const fill = type?.color ?? OBJECT_FALLBACK;
  const [x, y] = object.position;
  const [w, h] = object.size_m;
  const paint = `fill="${fill}" fill-opacity="0.9" stroke="#343A40" stroke-width="0.02"`;
  // Поворот модели — по часовой при Y вверх; в отражённой системе SVG это
  // тот же знак угла, потому что отражение уже учтено внешним transform.
  const rotate = `transform="translate(${n(x)},${n(y)}) rotate(${n(-object.rotation_deg)})"`;
  let shape: string;
  if (type?.symbol === 'circle') {
    shape = `<circle r="${n(Math.max(w, h) / 2)}" ${paint}/>`;
  } else if (type?.symbol === 'triangle') {
    shape = `<polygon points="0,${n(h / 2)} ${n(w / 2)},${n(-h / 2)} ${n(-w / 2)},${n(-h / 2)}" ${paint}/>`;
  } else {
    shape = `<rect x="${n(-w / 2)}" y="${n(-h / 2)}" width="${n(w)}" height="${n(h)}" ${paint}/>`;
  }
  return `<g ${rotate} data-id="${esc(object.id)}">${shape}</g>`;
}

/** Полный SVG-документ плана. */
export function renderPlanSvg(plan: PlanDocument): string {
  const shapes: Polygon[] = [plan.room.boundary, ...plan.zones.map((z) => z.polygon), ...plan.objects.map(footprint)];
  const all = shapes.flat();
  const box = boundingBox(all.length > 0 ? all : plan.room.boundary);
  const minX = box.minX - MARGIN_M;
  const minY = box.minY - MARGIN_M;
  const width = box.maxX - box.minX + MARGIN_M * 2;
  const height = box.maxY - box.minY + MARGIN_M * 2;

  const zones = plan.zones
    .slice()
    .sort((a, b) => (a.parentId === null ? 0 : 1) - (b.parentId === null ? 0 : 1))
    .map((zone) => {
      const fill = findZoneType(plan.catalog, zone.typeId)?.color ?? ZONE_FALLBACK;
      return (
        `<polygon points="${points(zone.polygon)}" fill="${fill}" fill-opacity="0.75" stroke="#ADB5BD" stroke-width="0.02" data-id="${esc(zone.id)}"/>` +
        label(centreOf(zone.polygon), zone.name, 0.35)
      );
    })
    .join('\n');

  const walls = plan.walls
    .map((wall) => `<polygon points="${points(wallPolygon(wall))}" fill="${WALL_FILL}" data-id="${esc(wall.id)}"/>`)
    .join('\n');

  const openings = plan.openings
    .map((opening) => {
      const wall = plan.walls.find((w) => w.id === opening.wallId);
      if (wall === undefined) return '';
      const length = Math.hypot(wall.to[0] - wall.from[0], wall.to[1] - wall.from[1]);
      if (length === 0) return '';
      const ux = (wall.to[0] - wall.from[0]) / length;
      const uy = (wall.to[1] - wall.from[1]) / length;
      const a: Point = [wall.from[0] + ux * opening.offset_m, wall.from[1] + uy * opening.offset_m];
      const b: Point = [a[0] + ux * opening.width_m, a[1] + uy * opening.width_m];
      return `<line x1="${n(a[0])}" y1="${n(a[1])}" x2="${n(b[0])}" y2="${n(b[1])}" stroke="${OPENING_STROKE}" stroke-width="${n(Math.max(0.06, wall.thickness_m))}" data-id="${esc(opening.id)}"/>`;
    })
    .join('\n');

  const objects = plan.objects.map((object) => objectSymbol(object, plan)).join('\n');
  const objectLabels = plan.objects
    .map((object) => label([object.position[0], object.position[1] - object.size_m[1] / 2 - 0.15], object.label, 0.18))
    .join('\n');

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

/** Имя файла картинки — как у файла плана, но `.svg`. */
export function svgFileName(plan: PlanDocument): string {
  const stem = plan.name.trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  return `${stem === '' ? 'plan' : stem}.svg`;
}
