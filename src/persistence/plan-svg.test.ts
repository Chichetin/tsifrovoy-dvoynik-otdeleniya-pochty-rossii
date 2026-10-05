/**
 * Картинка плана: тот же документ — тот же SVG, и всё, что есть в плане, есть
 * в файле. Главная проверка — поворот: отражение оси Y меняет знак угла, и
 * ошибиться здесь легко, а на картинке касса встанет зеркально.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { LayerType, PlanDocument, Point } from '../contracts/model';
import { footprint } from '../domain/geometry';
import { decodePlan } from './codec';
import { renderPlanSvg, svgFileName } from './plan-svg';
import { printLayout, renderPrintPage, rulerLengthM, svgExtentM } from './plan-print';

function loadFixture(name: string): PlanDocument {
  const result = decodePlan(readFileSync(join(process.cwd(), 'src', 'contracts', 'fixtures', name), 'utf8'));
  if (!result.ok) throw new Error(name);
  return result.value;
}

/** Points of the object's polygon as written in the SVG, in model metres (inside the Y flip). */
function objectPolygon(svg: string, id: string): Point[] {
  const match = new RegExp(`<g data-id="${id}"><polygon points="([^"]+)"`).exec(svg);
  if (match === null) throw new Error(`контур объекта ${id} не найден`);
  return match[1]!.split(' ').map((pair) => pair.split(',').map(Number) as Point);
}

describe('SVG плана', () => {
  test('один документ — один и тот же файл', () => {
    const plan = loadFixture('rotated.json');
    expect(renderPlanSvg(plan)).toBe(renderPlanSvg(plan));
  });

  test('в файле есть помещение, каждая зона, стена, проём и объект по id', () => {
    const plan = loadFixture('nested.json');
    const svg = renderPlanSvg(plan);
    for (const id of [plan.room.id, ...plan.zones.map((z) => z.id), ...plan.walls.map((w) => w.id), ...plan.openings.map((o) => o.id), ...plan.objects.map((o) => o.id)]) {
      expect(svg).toContain(`data-id="${id}"`);
    }
    expect(svg).toContain(`<title>${plan.name}</title>`);
  });

  test('зоны и объекты скрытого слоя не попадают в картинку', () => {
    const plan = loadFixture('nested.json');
    const hiddenLayer = plan.layers[0];
    if (hiddenLayer === undefined) throw new Error('нет слоя');
    const hidden: PlanDocument = {
      ...plan,
      layers: plan.layers.map((layer) =>
        layer.id === hiddenLayer.id ? { ...layer, visible: false } : layer,
      ),
    };
    const svg = renderPlanSvg(hidden);

    for (const zone of plan.zones.filter((entry) => entry.layerId === hiddenLayer.id)) {
      expect(svg).not.toContain(`data-id="${zone.id}"`);
    }
    for (const object of plan.objects.filter((entry) => entry.layerId === hiddenLayer.id)) {
      expect(svg).not.toContain(`data-id="${object.id}"`);
    }
    // Помещение, стены и проёмы не принадлежат слоям и остаются на схеме.
    expect(svg).toContain(`data-id="${plan.room.id}"`);
    for (const wall of plan.walls) expect(svg).toContain(`data-id="${wall.id}"`);
  });

  test('скрытый объект за пределами помещения не растягивает картинку', () => {
    const plan = loadFixture('minimal.json');
    const layer = plan.layers[0];
    const object = plan.objects[0];
    if (layer === undefined || object === undefined) throw new Error('нет данных');
    const hidden: PlanDocument = {
      ...plan,
      layers: [{ ...layer, visible: false }],
      objects: [{ ...object, position: [1000, 1000] as Point }],
    };
    const match = /viewBox="[-\d.]+ [-\d.]+ ([-\d.]+) ([-\d.]+)"/.exec(renderPlanSvg(hidden));
    if (match === null) throw new Error('нет viewBox');

    expect(Number(match[1])).toBeLessThan(20);
    expect(Number(match[2])).toBeLessThan(20);
  });

  test('цвет зоны и объекта — из справочника, не из кода', () => {
    const plan = loadFixture('nested.json');
    const svg = renderPlanSvg(plan);
    for (const type of plan.catalog.zoneTypes) expect(svg).toContain(`fill="${type.color}"`);
    for (const type of plan.catalog.objectTypes) expect(svg).toContain(`fill="${type.color}"`);
  });

  test('экспорт повторяет видимый цветовой слой состояния', () => {
    const base = loadFixture('nested.json');
    const status = JSON.parse(readFileSync(join(process.cwd(), 'data', 'catalog', 'layer-types.json'), 'utf8')) as LayerType[];
    const type = status.find((entry) => entry.id === 'lt_equipment_status')!;
    const object = base.objects[0]!;
    const plan: PlanDocument = {
      ...base,
      catalog: { ...base.catalog, layerTypes: [...base.catalog.layerTypes, type] },
      layers: [...base.layers, { id: 'l_status', name: type.label, visible: true, locked: false, order: 99, typeId: type.id }],
      objects: base.objects.map((entry) => entry.id === object.id
        ? { ...entry, attributes: { ...entry.attributes, equipmentStatus: 'repair' } }
        : entry),
    };
    expect(renderPlanSvg(plan)).toContain(`data-id="${object.id}"><polygon points=`);
    expect(renderPlanSvg(plan)).toMatch(new RegExp(`data-id="${object.id}"><polygon[^>]+fill="#A15C00"`));
  });

  test('повёрнутый объект стоит на картинке там же, где его отпечаток в модели', () => {
    // 37°, а не 90: у прямоугольника углы при +90 и −90 совпадают, и тест на
    // фикстуре с 90° не отличил бы обратный знак поворота.
    const base = loadFixture('rotated.json');
    const first = base.objects[0];
    if (first === undefined) throw new Error('нет объектов');
    const turned = { ...first, rotation_deg: 37, size_m: [1.4, 0.8] as Point };
    const plan: PlanDocument = { ...base, objects: [turned] };

    const svg = renderPlanSvg(plan);
    expect(svg).toContain('<g transform="scale(1,-1)">');
    // The polygon lives inside the outer Y flip: on screen a point is (x, −y).
    const onScreen = objectPolygon(svg, turned.id).map(([x, y]): Point => [x, -y]);

    // Clockwise with Y up, written out here rather than taken from the code
    // under test: (x, y) → (x cos a + y sin a, −x sin a + y cos a).
    const a = (37 * Math.PI) / 180;
    const [w, h] = turned.size_m;
    const [cx, cy] = turned.position;
    const corners: Point[] = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
    const expected = corners.map(([x, y]): Point => [
      cx + x * Math.cos(a) + y * Math.sin(a),
      -(cy - x * Math.sin(a) + y * Math.cos(a)),
    ]);

    expect(onScreen).toHaveLength(4);
    for (const corner of expected) {
      const hit = onScreen.some((p) => Math.hypot(p[0] - corner[0], p[1] - corner[1]) < 1e-3);
      expect(hit).toBe(true);
    }
  });

  test('объект с собственным контуром рисуется своим контуром, а не прямоугольником (D-277)', () => {
    const base = loadFixture('rotated.json');
    const first = base.objects[0];
    if (first === undefined) throw new Error('нет объектов');
    const corner = {
      ...first,
      rotation_deg: 0,
      outline: [[-0.5, -0.5], [0.5, -0.5], [0.5, 0], [0, 0], [0, 0.5], [-0.5, 0.5]] as Point[],
    };
    const svg = renderPlanSvg({ ...base, objects: [corner] });
    const written = objectPolygon(svg, corner.id);
    expect(written).toHaveLength(6);
    footprint(corner).forEach((point, index) => {
      expect(written[index]![0]).toBeCloseTo(point[0], 3);
      expect(written[index]![1]).toBeCloseTo(point[1], 3);
    });
  });

  test('viewBox покрывает помещение и объект, вынесенный за его стены', () => {
    const plan = loadFixture('minimal.json');
    const outside: PlanDocument = {
      ...plan,
      objects: plan.objects.map((o) => ({ ...o, position: [30, 30] as Point })),
    };
    const svg = renderPlanSvg(outside);
    const viewBox = /viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/.exec(svg);
    if (viewBox === null) throw new Error('нет viewBox');
    const [, minX, minY, width, height] = viewBox;
    expect(Number(minX) + Number(width)).toBeGreaterThan(30);
    // Ось Y отражена: модельный y = 30 лежит на SVG-y = −30, и viewBox должен
    // начинаться не ниже, чем −30 − запас.
    expect(Number(minY)).toBeLessThanOrEqual(-30);
    expect(Number(minY) + Number(height)).toBeGreaterThanOrEqual(-30 + 1);
  });

  test('стена вне контура попадает в охват картинки', () => {
    const plan = loadFixture('minimal.json');
    const away: PlanDocument = {
      ...plan,
      walls: [...plan.walls, { id: 'w_far', from: [25, 1], to: [25, 5], thickness_m: 0.2, height_m: 3 }],
    };
    const viewBox = /viewBox="([-\d.]+) [-\d.]+ ([-\d.]+) /.exec(renderPlanSvg(away));
    if (viewBox === null) throw new Error('нет viewBox');
    expect(Number(viewBox[1]) + Number(viewBox[2])).toBeGreaterThan(25);
  });

  test('мелкий объект без подписи, крупный — с подписью', () => {
    const plan = loadFixture('minimal.json');
    const first = plan.objects[0];
    if (first === undefined) throw new Error('нет объектов');
    const tiny = { ...first, id: 'eq_tiny', label: 'Датчик-крошка', size_m: [0.3, 0.3] as Point };
    const big = { ...first, id: 'eq_big', label: 'Стол-великан', size_m: [1, 1] as Point, position: [5, 5] as Point };
    const svg = renderPlanSvg({ ...plan, objects: [tiny, big] });

    expect(svg).toContain('data-id="eq_tiny"');
    expect(svg).not.toContain('Датчик-крошка');
    expect(svg).toContain('Стол-великан');
  });

  test('готовая SVG-картинка сохраняет смысловой значок объекта', () => {
    const plan = loadFixture('minimal.json');
    const svg = renderPlanSvg(plan);
    expect(svg).toContain('data-pictogram="workplace"');
    expect(svg).toContain('<path d="M4 3H20V12H4Z');
  });

  test('заливка зоны — под объектами, подписи — поверх и одним размером', () => {
    const plan = loadFixture('nested.json');
    const svg = renderPlanSvg(plan);
    const zone = plan.zones[0];
    const object = plan.objects[0];
    if (zone === undefined || object === undefined) throw new Error('нет данных');
    const zoneLabel = svg.indexOf(`>${zone.name}</text>`);
    const objectGroup = svg.indexOf(`data-id="${object.id}"`);
    expect(zoneLabel).toBeGreaterThan(-1);
    const zoneShape = svg.indexOf(`data-id="${zone.id}"`);
    expect(zoneShape).toBeGreaterThan(-1);
    expect(objectGroup).toBeGreaterThan(zoneShape);
    expect(zoneLabel).toBeGreaterThan(objectGroup);
    // Поведение, а не константы оформления: подпись зоны бледнее подписи
    // объекта. После #143 подписи имеют один размер и размещаются поверх
    // фигур, чтобы стены и оборудование не закрывали текст.
    const attr = (tag: string, name: string): number => {
      const start = tag.indexOf(`${name}="`);
      if (start < 0) return Number.NaN;
      const from = start + name.length + 2;
      return Number(tag.slice(from, tag.indexOf('"', from)));
    };
    const zoneTag = svg.slice(svg.lastIndexOf('<text', zoneLabel), zoneLabel);
    const objectLabel = svg.indexOf(`>${object.label}</text>`);
    expect(objectLabel).toBeGreaterThan(-1);
    const objectTag = svg.slice(svg.lastIndexOf('<text', objectLabel), objectLabel);
    expect(attr(zoneTag, 'fill-opacity')).toBeLessThan(1);
    expect(attr(zoneTag, 'fill-opacity')).toBeLessThan(attr(objectTag, 'fill-opacity'));
    expect(attr(zoneTag, 'font-size')).toBeGreaterThan(0);
    expect(attr(zoneTag, 'font-size')).toBe(attr(objectTag, 'font-size'));
  });

  test('цвет из справочника экранируется как всё из документа', () => {
    const plan = loadFixture('minimal.json');
    const hostile: PlanDocument = {
      ...plan,
      catalog: {
        ...plan.catalog,
        zoneTypes: plan.catalog.zoneTypes.map((t) => ({ ...t, color: '#fff" onload="x' })),
      },
    };
    const svg = renderPlanSvg(hostile);
    expect(svg).not.toContain('onload="x');
    expect(svg).toContain('&quot; onload=&quot;x');
  });

  test('спецсимволы в названии экранируются', () => {
    const plan = { ...loadFixture('minimal.json'), name: 'Зал <A> & "Б"' };
    const svg = renderPlanSvg(plan);
    expect(svg).toContain('<title>Зал &lt;A&gt; &amp; &quot;Б&quot;</title>');
    expect(svg).not.toContain('<A>');
  });

  test('имя файла — из названия плана', () => {
    expect(svgFileName({ ...loadFixture('minimal.json'), name: 'ОПС 12 / зал' })).toBe('ОПС-12-зал.svg');
    expect(svgFileName({ ...loadFixture('minimal.json'), name: '   ' })).toBe('plan.svg');
  });

  test('печать: 1:100 даёт 10 мм на метр, большой план не помещается, линейка круглая', () => {
    const layout = printLayout([10, 6], 'A4', 'landscape', 100);
    expect(layout.mmPerM).toBe(10);
    expect(layout.drawingMm).toEqual([100, 60]);
    expect(layout.fits).toBe(true);
    expect(printLayout([30, 6], 'A4', 'landscape', 50).fits).toBe(false);
    expect(printLayout([30, 6], 'A4', 'landscape', 'fit').fits).toBe(true);
    expect(rulerLengthM(10, 60)).toBe(5);
    const plan = loadFixture('minimal.json');
    const [w] = svgExtentM(renderPlanSvg(plan));
    const page = renderPrintPage(plan, { format: 'A3', orientation: 'landscape', scale: 100, date: new Date(2026, 9, 5) });
    expect(page).toContain(`width="${(w * 10).toFixed(2)}mm"`);
  });
});
