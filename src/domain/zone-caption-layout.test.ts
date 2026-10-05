import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { parsePlanDocument } from '../contracts/schema';
import { contains } from './geometry';
import { placeZoneCaption, zoneCaptionBoxes, type CaptionBox } from './zone-caption-layout';

function overlaps(a: CaptionBox, b: CaptionBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe('размещение названия зоны', () => {
  test('уходит вбок, когда вся центральная вертикаль занята', () => {
    const obstacle = { x: 90, y: 0, width: 30, height: 180 };
    const box = placeZoneCaption([[0, 0], [240, 0], [240, 180], [0, 180]], 60, 30, [obstacle]);
    expect(overlaps(box, obstacle)).toBe(false);
    expect(box.y + box.height / 2).toBe(90);
  });
  test('полная бирка остаётся внутри вогнутой зоны', () => {
    const polygon: [number, number][] = [[0, 0], [200, 0], [200, 70], [70, 70], [70, 200], [0, 200]];
    const box = placeZoneCaption(polygon, 50, 30, []);
    expect(contains(polygon, [[box.x, box.y], [box.x + box.width, box.y],
      [box.x + box.width, box.y + box.height], [box.x, box.y + box.height]])).toBe(true);
  });
  test('слишком тесная зона даёт конечное положение и не меняет препятствия', () => {
    const obstacle = { x: 0, y: 0, width: 30, height: 30 };
    const box = placeZoneCaption([[0, 0], [30, 0], [30, 30], [0, 30]], 118, 32, [obstacle]);
    expect(Object.values(box).every(Number.isFinite)).toBe(true);
    expect(obstacle).toEqual({ x: 0, y: 0, width: 30, height: 30 });
  });
  test('скрытый слой не оставляет названия, расчёт не меняет план и сдвигается вместе с viewport', () => {
    const parsed = parsePlanDocument(JSON.parse(readFileSync('demo/before.json', 'utf8')));
    if (!parsed.ok) throw new Error('Нет демо');
    const plan = parsed.value;
    const original = structuredClone(plan);
    const a = zoneCaptionBoxes(plan, { origin: [0, 0], scale: 40 }).get('z_staff')!;
    const b = zoneCaptionBoxes(plan, { origin: [120, 60], scale: 40 }).get('z_staff')!;
    expect(b.x - a.x).toBeCloseTo(120);
    expect(b.y - a.y).toBeCloseTo(60);
    expect(plan).toEqual(original);
    const hidden = { ...plan, layers: plan.layers.map((layer) => ({ ...layer, visible: false })) };
    expect(zoneCaptionBoxes(hidden, { origin: [0, 0], scale: 40 }).size).toBe(0);
  });
  test('учитывает явные переводы строк и самостоятельный значок камеры', () => {
    const parsed = parsePlanDocument(JSON.parse(readFileSync('demo/before.json', 'utf8')));
    if (!parsed.ok) throw new Error('Нет демо');
    const camera = { ...parsed.value.objects[0]!, typeId: 'ot_camera', size_m: [0.08, 0.08] as [number, number], position: [2, 2.23] as [number, number] };
    const zone = { ...parsed.value.zones[0]!, name: 'ЗАЛ', polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] as [number, number][] };
    const catalog = { ...parsed.value.catalog, objectTypes: parsed.value.catalog.objectTypes.map((type) => (type.id === 'ot_camera' ? { ...type, pictogram: 'camera' as const } : type)) };
    const plan = { ...parsed.value, catalog, objects: [camera], zones: [zone] };
    const viewport = { origin: [0, 0] as [number, number], scale: 50 };
    const box = zoneCaptionBoxes(plan, viewport).get(zone.id)!;
    expect(overlaps(box, { x: 100 - 7.07, y: -111.5 - 7.07, width: 14.14, height: 14.14 })).toBe(false);
    const multiline = zoneCaptionBoxes({ ...plan, zones: [{ ...zone, name: 'ЗАЛ\n№1' }] }, viewport).get(zone.id)!;
    expect(multiline.height).toBeGreaterThanOrEqual(26);
  });
});
