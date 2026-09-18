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
    const [, minX, , width] = viewBox;
    expect(Number(minX) + Number(width)).toBeGreaterThan(30);
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
