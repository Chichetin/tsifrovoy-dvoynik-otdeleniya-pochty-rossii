/**
 * U02 unit checks: «покажи мне это» — что именно показывать и куда для этого
 * смотреть.
 *
 * Панели проверки, инвентаризации и ассистента отдают холсту `Ref`. Решения,
 * которые от этого зависят, жюри чувствует так: «нажал на находку — объект
 * оказался на экране», «объект и так был виден — план не дёрнулся», «открыл
 * файл — план целиком в холсте, включая объект, уехавший за стену». Всё это
 * арифметика, поэтому закреплена здесь, а не в компоненте.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { PlanDocument, Polygon, Viewport } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import { boundingBox, modelToScreen } from '../../domain/geometry';
import { FOCUS_MARGIN_PX, focusViewport, planExtent, refExtent } from './focus';
import type { CanvasSize } from './viewport';

const canvas: CanvasSize = { width: 800, height: 600 };

function loadPlan(name: string): PlanDocument {
  const path = join(process.cwd(), 'src', 'contracts', 'fixtures', name);
  const parsed = parsePlanDocument(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  if (!parsed.ok) throw new Error(`${name}: ${parsed.issues.map((issue) => issue.code).join(', ')}`);
  return parsed.value;
}

const plan = loadPlan('minimal.json');

/** Сдвигает единственный объект фикстуры — так рождается объект вне помещения. */
function withObjectAt(source: PlanDocument, x: number, y: number): PlanDocument {
  return {
    ...source,
    objects: source.objects.map((object, index) =>
      index === 0 ? { ...object, position: [x, y] as [number, number] } : object,
    ),
  };
}

/** Экранный прямоугольник мировой фигуры при данном виде. */
function screenBox(extent: Polygon, viewport: Viewport): {
  left: number;
  right: number;
  top: number;
  bottom: number;
} {
  const points = extent.map((point) => modelToScreen(point, viewport));
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
}

function fullyVisible(extent: Polygon, viewport: Viewport): boolean {
  const box = screenBox(extent, viewport);
  return box.left >= 0 && box.top >= 0 && box.right <= canvas.width && box.bottom <= canvas.height;
}

describe('что именно показывать по ссылке', () => {
  test('объект — его отпечаток с учётом размера', () => {
    const extent = refExtent(plan, { kind: 'object', id: 'eq_work_1' });
    expect(extent).not.toBeNull();
    const box = boundingBox(extent as Polygon);
    expect(box.minX).toBeCloseTo(2 - 0.7, 9);
    expect(box.maxX).toBeCloseTo(2 + 0.7, 9);
    expect(box.minY).toBeCloseTo(2 - 0.4, 9);
    expect(box.maxY).toBeCloseTo(2 + 0.4, 9);
  });

  test('повёрнутый объект показывается по повёрнутому отпечатку', () => {
    const turned: PlanDocument = {
      ...plan,
      objects: plan.objects.map((object, index) =>
        index === 0 ? { ...object, rotation_deg: 90 } : object,
      ),
    };
    const box = boundingBox(refExtent(turned, { kind: 'object', id: 'eq_work_1' }) as Polygon);
    // Поворот на 90° меняет стороны местами: 1.4 × 0.8 становится 0.8 × 1.4.
    expect(box.maxX - box.minX).toBeCloseTo(0.8, 9);
    expect(box.maxY - box.minY).toBeCloseTo(1.4, 9);
  });

  test('зона — её контур, помещение — граница', () => {
    expect(refExtent(plan, { kind: 'zone', id: 'z_client' })).toEqual(plan.zones[0]?.polygon);
    expect(refExtent(plan, { kind: 'room', id: 'room_main' })).toEqual(plan.room.boundary);
  });

  test('перегородка и проём тоже находятся', () => {
    const wall = boundingBox(refExtent(plan, { kind: 'wall', id: 'w_north' }) as Polygon);
    expect(wall.minX).toBeCloseTo(0, 9);
    expect(wall.maxX).toBeCloseTo(10, 9);
    expect(wall.maxY - wall.minY).toBeCloseTo(0.2, 9);

    const opening = boundingBox(refExtent(plan, { kind: 'opening', id: 'op_entrance' }) as Polygon);
    // Середина проёма: 4 м от начала стены плюс половина ширины 1.2 м.
    expect((opening.minX + opening.maxX) / 2).toBeCloseTo(4.6, 9);
    expect((opening.minY + opening.maxY) / 2).toBeCloseTo(8, 9);
    expect(opening.maxX - opening.minX).toBeCloseTo(1.2, 9);

    // Узкий проём не превращается в полоску в пару пикселей: у показа есть
    // минимальный размер, иначе на плане его не разглядеть.
    const narrow: PlanDocument = {
      ...plan,
      openings: plan.openings.map((entry) => ({ ...entry, width_m: 0.3 })),
    };
    const tiny = boundingBox(refExtent(narrow, { kind: 'opening', id: 'op_entrance' }) as Polygon);
    expect(tiny.maxX - tiny.minX).toBeCloseTo(0.6, 9);
  });

  test('неизвестная ссылка ничего не ломает', () => {
    expect(refExtent(plan, { kind: 'object', id: 'eq_missing' })).toBeNull();
    expect(refExtent(plan, { kind: 'zone', id: 'z_missing' })).toBeNull();
    expect(refExtent(plan, { kind: 'wall', id: 'w_missing' })).toBeNull();
    expect(refExtent(plan, { kind: 'room', id: 'room_other' })).toBeNull();
    expect(refExtent(plan, { kind: 'layer', id: 'l_base' })).toBeNull();
  });
});

describe('план целиком', () => {
  test('без содержимого — это граница помещения', () => {
    const empty: PlanDocument = { ...plan, zones: [], objects: [], walls: [] };
    const box = boundingBox(planExtent(empty));
    expect([box.minX, box.minY, box.maxX, box.maxY]).toEqual([0, 0, 10, 8]);
  });

  test('объект за стеной входит в план целиком, иначе его не найти', () => {
    const box = boundingBox(planExtent(withObjectAt(plan, 30, 20)));
    // Не центр объекта, а его край: вписанный план не режет дальнюю половину
    // отпечатка размером 1.4 × 0.8 м.
    expect(box.maxX).toBeCloseTo(30 + 0.7, 9);
    expect(box.maxY).toBeCloseTo(20 + 0.4, 9);
  });

  test('зона и перегородка за границей помещения тоже попадают в охват', () => {
    const outside: PlanDocument = {
      ...plan,
      zones: plan.zones.map((zone) => ({
        ...zone,
        polygon: [[-4, -3], [-1, -3], [-1, -1], [-4, -1]] as Polygon,
      })),
    };
    const box = boundingBox(planExtent(outside));
    expect(box.minX).toBeLessThanOrEqual(-4);
    expect(box.minY).toBeLessThanOrEqual(-3);
  });

  test('пустой документ без помещения не роняет вписывание', () => {
    const nothing: PlanDocument = {
      ...plan,
      room: { ...plan.room, boundary: [] as unknown as Polygon },
      zones: [],
      objects: [],
      walls: [],
    };
    expect(planExtent(nothing)).toEqual([]);
  });
});

describe('переход к объекту', () => {
  const zoomedIn: Viewport = { origin: [100, 500], scale: 60 };

  test('объект уже виден целиком — вид не меняется вовсе', () => {
    const extent = refExtent(plan, { kind: 'object', id: 'eq_work_1' }) as Polygon;
    expect(fullyVisible(extent, zoomedIn)).toBe(true);
    expect(focusViewport(extent, zoomedIn, canvas)).toBe(zoomedIn);
  });

  test('поля соблюдаются со всех четырёх сторон, а не только справа', () => {
    const extent = refExtent(plan, { kind: 'object', id: 'eq_work_1' }) as Polygon;
    const box = boundingBox(extent);
    const scale = 60;
    // Прижимаем отпечаток к каждому краю так, чтобы он был виден, но лежал в
    // полосе полей: холст обязан подвинуться в каждом из четырёх случаев.
    const corners: Viewport[] = [
      { scale, origin: [FOCUS_MARGIN_PX / 2 - box.minX * scale, 300] },
      { scale, origin: [canvas.width - box.maxX * scale - FOCUS_MARGIN_PX / 2, 300] },
      { scale, origin: [300, FOCUS_MARGIN_PX / 2 + box.maxY * scale] },
      { scale, origin: [300, canvas.height - FOCUS_MARGIN_PX / 2 + box.minY * scale] },
    ];

    for (const viewport of corners) {
      expect(fullyVisible(extent, viewport)).toBe(true);
      const next = focusViewport(extent, viewport, canvas);
      expect(next).not.toBe(viewport);
      const moved = screenBox(extent, next);
      expect(moved.left).toBeGreaterThanOrEqual(FOCUS_MARGIN_PX);
      expect(moved.top).toBeGreaterThanOrEqual(FOCUS_MARGIN_PX);
      expect(moved.right).toBeLessThanOrEqual(canvas.width - FOCUS_MARGIN_PX);
      expect(moved.bottom).toBeLessThanOrEqual(canvas.height - FOCUS_MARGIN_PX);
    }
  });

  test('объект у самого края холста считается невидимым и отодвигается от края', () => {
    const extent = refExtent(plan, { kind: 'object', id: 'eq_work_1' }) as Polygon;
    const box = boundingBox(extent);
    // Ставим правый край отпечатка в нескольких пикселях от края холста.
    const scale = 60;
    const edge: Viewport = {
      scale,
      origin: [canvas.width - box.maxX * scale - FOCUS_MARGIN_PX / 2, 400],
    };
    expect(fullyVisible(extent, edge)).toBe(true);

    const next = focusViewport(extent, edge, canvas);
    expect(next).not.toBe(edge);
    expect(next.scale).toBe(scale);
    const moved = screenBox(extent, next);
    expect(moved.right).toBeLessThanOrEqual(canvas.width - FOCUS_MARGIN_PX);
    expect(moved.left).toBeGreaterThanOrEqual(FOCUS_MARGIN_PX);
  });

  test('объект далеко за экраном — масштаб сохраняется, объект в центре', () => {
    const far = withObjectAt(plan, 30, 20);
    const extent = refExtent(far, { kind: 'object', id: 'eq_work_1' }) as Polygon;
    expect(fullyVisible(extent, zoomedIn)).toBe(false);

    const next = focusViewport(extent, zoomedIn, canvas);
    expect(next.scale).toBe(zoomedIn.scale);
    expect(fullyVisible(extent, next)).toBe(true);
    const box = screenBox(extent, next);
    expect((box.left + box.right) / 2).toBeCloseTo(canvas.width / 2, 6);
    expect((box.top + box.bottom) / 2).toBeCloseTo(canvas.height / 2, 6);
  });

  test('фигура больше экрана — масштаб уменьшается ровно настолько, чтобы она влезла', () => {
    const extent = refExtent(plan, { kind: 'zone', id: 'z_client' }) as Polygon;
    const tight: Viewport = { origin: [0, 600], scale: 200 };
    const next = focusViewport(extent, tight, canvas);

    expect(next.scale).toBeLessThan(tight.scale);
    expect(fullyVisible(extent, next)).toBe(true);
    const box = screenBox(extent, next);
    expect(box.left).toBeGreaterThanOrEqual(FOCUS_MARGIN_PX - 1);
    expect(box.right).toBeLessThanOrEqual(canvas.width - FOCUS_MARGIN_PX + 1);
  });

  test('вырожденная фигура не делит на ноль и попадает в центр', () => {
    const point: Polygon = [[40, 40]];
    const next = focusViewport(point, zoomedIn, canvas);
    expect(next.scale).toBe(zoomedIn.scale);
    expect(modelToScreen([40, 40], next)[0]).toBeCloseTo(canvas.width / 2, 6);
    expect(modelToScreen([40, 40], next)[1]).toBeCloseTo(canvas.height / 2, 6);
  });

  test('пустая фигура оставляет вид как есть', () => {
    expect(focusViewport([], zoomedIn, canvas)).toBe(zoomedIn);
  });

  test('холст ещё не измерен — переход ничего не портит', () => {
    const extent = refExtent(plan, { kind: 'object', id: 'eq_work_1' }) as Polygon;
    expect(focusViewport(extent, zoomedIn, { width: 0, height: 0 })).toBe(zoomedIn);
  });
});
