/**
 * Картинка плана: тот же документ — тот же SVG, и всё, что есть в плане, есть
 * в файле. Главная проверка — поворот: отражение оси Y меняет знак угла, и
 * ошибиться здесь легко, а на картинке касса встанет зеркально.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { PlanDocument, Point } from '../contracts/model';
import { footprint } from '../domain/geometry';
import { decodePlan } from './codec';
import { renderPlanSvg, svgFileName } from './plan-svg';

function loadFixture(name: string): PlanDocument {
  const result = decodePlan(readFileSync(join(process.cwd(), 'src', 'contracts', 'fixtures', name), 'utf8'));
  if (!result.ok) throw new Error(name);
  return result.value;
}

/**
 * Где на экране окажется локальная точка прямоугольника: цепочка трансформаций
 * SVG применяется буквально, как в браузере, — `rotate` и `translate` группы,
 * затем внешний `scale(1,-1)`. Итог сравнивается с отпечатком модели,
 * отражённым той же осью: так проверяется и знак угла, и само отражение.
 */
function svgPoint(local: Point, translate: Point, rotateDeg: number, flipY: boolean): Point {
  const a = (rotateDeg * Math.PI) / 180;
  const [x, y] = local;
  // SVG rotate(a): x' = x cos a − y sin a, y' = x sin a + y cos a.
  const rx = translate[0] + x * Math.cos(a) - y * Math.sin(a);
  const ry = translate[1] + x * Math.sin(a) + y * Math.cos(a);
  return [rx, flipY ? -ry : ry];
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

  test('цвет зоны и объекта — из справочника, не из кода', () => {
    const plan = loadFixture('nested.json');
    const svg = renderPlanSvg(plan);
    for (const type of plan.catalog.zoneTypes) expect(svg).toContain(`fill="${type.color}"`);
    for (const type of plan.catalog.objectTypes) expect(svg).toContain(`fill="${type.color}"`);
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
    const group = new RegExp(`transform="translate\\(([-\\d.]+),([-\\d.]+)\\) rotate\\(([-\\d.]+)\\)" data-id="${turned.id}"`).exec(svg);
    if (group === null) throw new Error('группа объекта не найдена');
    const translate: Point = [Number(group[1]), Number(group[2])];
    const rotate = Number(group[3]);

    const [w, h] = turned.size_m;
    const corners: Point[] = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
    // Экранные точки SVG (Y вниз) против отпечатка модели, отражённого той же осью.
    const onScreen = corners.map((c) => svgPoint(c, translate, rotate, true));
    const expected = footprint(turned).map(([x, y]): Point => [x, -y]);

    // Оба набора — одни и те же четыре угла, порядок может отличаться.
    for (const corner of expected) {
      const hit = onScreen.some((p) => Math.hypot(p[0] - corner[0], p[1] - corner[1]) < 1e-6);
      expect(hit).toBe(true);
    }
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

  test('название зоны — бледнее и до объектов, чтобы не спорить с оборудованием', () => {
    const plan = loadFixture('nested.json');
    const svg = renderPlanSvg(plan);
    const zone = plan.zones[0];
    const object = plan.objects[0];
    if (zone === undefined || object === undefined) throw new Error('нет данных');
    const zoneLabel = svg.indexOf(`>${zone.name}</text>`);
    const objectGroup = svg.indexOf(`data-id="${object.id}"`);
    expect(zoneLabel).toBeGreaterThan(-1);
    expect(zoneLabel).toBeLessThan(objectGroup);
    // Поведение, а не константы оформления: подпись зоны бледнее подписи
    // объекта и крупнее её — иначе она либо спорит с оборудованием, либо
    // теряется на фоне. Точные числа менять можно, соотношение — нет.
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
    expect(attr(zoneTag, 'font-size')).toBeGreaterThan(attr(objectTag, 'font-size'));
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
});
