/**
 * U02 unit checks: «Картинка PNG» — какой кусок холста выгружать, с каким
 * разрешением, как назвать файл и что подписать над планом.
 *
 * Руководитель показывает картинку на согласовании, поэтому на ней должен быть
 * весь план, а не тот кусок, который пользователь сейчас разглядывает, и
 * информационный слой не должен выглядеть измерением. Это арифметика и строки —
 * закреплены здесь, а не в компоненте.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { PlanDocument, Polygon, Viewport } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import { screenToModel } from '../../domain/geometry';
import {
  EXPORT_MARGIN_M,
  EXPORT_MAX_SIDE_PX,
  EXPORT_MIN_PIXEL_RATIO,
  EXPORT_TARGET_PX_PER_M,
  exportFileName,
  exportFrame,
  exportHeader,
} from './export';
import { planExtent } from './focus';

function load(path: string): PlanDocument {
  const parsed = parsePlanDocument(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  if (!parsed.ok) throw new Error(`${path}: ${parsed.issues.map((issue) => issue.code).join(', ')}`);
  return parsed.value;
}

const demo = load(join(process.cwd(), 'demo', 'before.json'));

/** Прямоугольник 0..15 × 0..10 м — габарит помещения демо-плана. */
const extent: Polygon = [
  [0, 0],
  [15, 0],
  [15, 10],
  [0, 10],
];

/** Вписанный вид: 50 px/м, начало мира в (100, 600) экрана. */
const fitted: Viewport = { scale: 50, origin: [100, 600] };

describe('exportFrame', () => {
  test('охватывает весь габарит плана с полями, а не видимый кусок', () => {
    const frame = exportFrame(extent, fitted);
    expect(frame).not.toBeNull();
    if (frame === null) return;

    const topLeft = screenToModel([frame.x, frame.y], fitted);
    const bottomRight = screenToModel([frame.x + frame.width, frame.y + frame.height], fitted);
    // Экран: Y вниз, поэтому верх рамки — это максимум Y мира.
    expect(topLeft[0]).toBeCloseTo(-EXPORT_MARGIN_M, 1);
    expect(topLeft[1]).toBeCloseTo(10 + EXPORT_MARGIN_M, 1);
    expect(bottomRight[0]).toBeCloseTo(15 + EXPORT_MARGIN_M, 1);
    expect(bottomRight[1]).toBeCloseTo(-EXPORT_MARGIN_M, 1);
  });

  test('рамка не зависит от того, куда пользователь сдвинул и насколько приблизил вид', () => {
    const zoomedIn: Viewport = { scale: 200, origin: [-1200, 900] };
    const frame = exportFrame(extent, zoomedIn);
    if (frame === null) throw new Error('frame expected');

    // Рамка почти целиком за пределами холста 800 × 600 — так и должно быть.
    const topLeft = screenToModel([frame.x, frame.y], zoomedIn);
    const bottomRight = screenToModel([frame.x + frame.width, frame.y + frame.height], zoomedIn);
    expect(topLeft[0]).toBeLessThanOrEqual(-EXPORT_MARGIN_M + 0.01);
    expect(topLeft[1]).toBeGreaterThanOrEqual(10 + EXPORT_MARGIN_M - 0.01);
    expect(bottomRight[0]).toBeGreaterThanOrEqual(15 + EXPORT_MARGIN_M - 0.01);
    expect(bottomRight[1]).toBeLessThanOrEqual(-EXPORT_MARGIN_M + 0.01);
  });

  test('рамка в целых пикселях и не уже габарита', () => {
    const odd: Viewport = { scale: 37.3, origin: [11.4, 512.7] };
    const frame = exportFrame(extent, odd);
    if (frame === null) throw new Error('frame expected');
    for (const value of [frame.x, frame.y, frame.width, frame.height]) {
      expect(Number.isInteger(value)).toBe(true);
    }
    // Округление наружу: край поля не срезается ни с одной стороны.
    const topLeft = screenToModel([frame.x, frame.y], odd);
    const bottomRight = screenToModel([frame.x + frame.width, frame.y + frame.height], odd);
    expect(topLeft[0]).toBeLessThanOrEqual(-EXPORT_MARGIN_M);
    expect(topLeft[1]).toBeGreaterThanOrEqual(10 + EXPORT_MARGIN_M);
    expect(bottomRight[0]).toBeGreaterThanOrEqual(15 + EXPORT_MARGIN_M);
    expect(bottomRight[1]).toBeLessThanOrEqual(-EXPORT_MARGIN_M);
    expect(frame.width).toBeGreaterThanOrEqual((15 + 2 * EXPORT_MARGIN_M) * odd.scale);
    expect(frame.height).toBeGreaterThanOrEqual((10 + 2 * EXPORT_MARGIN_M) * odd.scale);
  });

  test('на мелком масштабе разрешение поднимается до целевого числа пикселей на метр', () => {
    const small: Viewport = { scale: 20, origin: [50, 400] };
    const frame = exportFrame(extent, small);
    if (frame === null) throw new Error('frame expected');
    expect(frame.pixelRatio * small.scale).toBeCloseTo(EXPORT_TARGET_PX_PER_M, 6);
  });

  test('на крупном масштабе разрешение не ниже двукратного', () => {
    const large: Viewport = { scale: 90, origin: [50, 1000] };
    const frame = exportFrame(extent, large);
    if (frame === null) throw new Error('frame expected');
    expect(frame.pixelRatio).toBe(EXPORT_MIN_PIXEL_RATIO);
  });

  test('картинка не выходит за предел стороны, который выдерживает браузер', () => {
    const huge: Polygon = [
      [0, 0],
      [200, 0],
      [200, 40],
      [0, 40],
    ];
    const frame = exportFrame(huge, { scale: 60, origin: [0, 0] });
    if (frame === null) throw new Error('frame expected');
    const longest = Math.max(frame.width, frame.height) * frame.pixelRatio;
    expect(longest).toBeLessThanOrEqual(EXPORT_MAX_SIDE_PX);
    expect(longest).toBeGreaterThan(EXPORT_MAX_SIDE_PX - 1);
  });

  test('пустой план выгружать нечего', () => {
    expect(exportFrame([], fitted)).toBeNull();
  });

  test('вырожденный вид с нулевым масштабом не даёт пустой картинки', () => {
    expect(exportFrame(extent, { scale: 0, origin: [0, 0] })).toBeNull();
  });

  test('точка без размеров всё равно даёт рамку за счёт полей', () => {
    const frame = exportFrame([[3, 4]], fitted);
    if (frame === null) throw new Error('frame expected');
    expect(frame.width).toBeGreaterThan(0);
    expect(frame.height).toBeGreaterThan(0);
  });

  test('демо-план: рамка покрывает planExtent целиком', () => {
    const planBox = planExtent(demo);
    const frame = exportFrame(planBox, fitted);
    if (frame === null) throw new Error('frame expected');
    const topLeft = screenToModel([frame.x, frame.y], fitted);
    const bottomRight = screenToModel([frame.x + frame.width, frame.y + frame.height], fitted);
    for (const [x, y] of planBox) {
      expect(x).toBeGreaterThan(topLeft[0]);
      expect(x).toBeLessThan(bottomRight[0]);
      expect(y).toBeLessThan(topLeft[1]);
      expect(y).toBeGreaterThan(bottomRight[1]);
    }
  });
});

describe('exportFileName', () => {
  test('имя берётся из названия плана, знаки препинания — в дефисы', () => {
    expect(exportFileName('Демо-ОПС «Синтетическое» — учебное отделение')).toBe(
      'Демо-ОПС-Синтетическое-учебное-отделение.png',
    );
  });

  test('цифры и латиница сохраняются', () => {
    expect(exportFileName('OPS 101000 v2')).toBe('OPS-101000-v2.png');
  });

  test('без названия — plan.png', () => {
    expect(exportFileName('')).toBe('plan.png');
    expect(exportFileName('  «» — / ')).toBe('plan.png');
  });

  test('символы, запрещённые в именах файлов, не проходят', () => {
    const name = exportFileName('a/b\\c:d*e?f"g<h>i|j');
    expect(name).toBe('a-b-c-d-e-f-g-h-i-j.png');
  });

  test('длинное название обрезается без хвостового дефиса', () => {
    const name = exportFileName(`${'а'.repeat(79)} б`);
    expect(name.length).toBeLessThanOrEqual(84);
    expect(name.endsWith('-.png')).toBe(false);
    expect(name.endsWith('.png')).toBe(true);
  });
});

describe('exportHeader', () => {
  test('заголовок — название плана; без информационных слоёв подписей нет', () => {
    expect(exportHeader(demo)).toEqual({ title: demo.name, notes: [] });
  });

  test('видимый информационный слой даёт подпись «числа синтетические»', () => {
    const withHeat: PlanDocument = {
      ...demo,
      layers: demo.layers.map((layer) =>
        layer.typeId === 'lt_heat' || layer.typeId === 'lt_cameras'
          ? { ...layer, visible: true }
          : layer,
      ),
    };
    expect(exportHeader(withHeat).notes).toEqual([
      'Камеры и зоны обзора: числа синтетические',
      'Тепловая нагрузка зон: числа синтетические',
    ]);
  });

  test('подписи идут в порядке слоёв, а не в порядке массива', () => {
    const reordered: PlanDocument = {
      ...demo,
      layers: demo.layers.map((layer) => {
        if (layer.typeId === 'lt_heat') return { ...layer, visible: true, order: -2 };
        if (layer.typeId === 'lt_cameras') return { ...layer, visible: true, order: 50 };
        return layer;
      }),
    };
    expect(exportHeader(reordered).notes).toEqual([
      'Тепловая нагрузка зон: числа синтетические',
      'Камеры и зоны обзора: числа синтетические',
    ]);
  });

  test('обычный слой объектов подписи не даёт, даже видимый', () => {
    const plain = demo.layers.filter((layer) => layer.typeId === undefined || layer.typeId === null);
    expect(plain.some((layer) => layer.visible)).toBe(true);
    expect(exportHeader({ ...demo, layers: plain }).notes).toEqual([]);
  });

  test('слой с типом из справочника, но вида «объекты», подписи не даёт', () => {
    const typed: PlanDocument = {
      ...demo,
      catalog: {
        ...demo.catalog,
        layerTypes: [
          ...demo.catalog.layerTypes,
          { id: 'lt_furniture', label: 'Мебель', representation: { kind: 'objects' }, note: '' },
        ],
      },
      layers: [
        ...demo.layers,
        { ...(demo.layers[0] as PlanDocument['layers'][number]), id: 'l_furniture', typeId: 'lt_furniture', visible: true },
      ],
    };
    expect(exportHeader(typed).notes).toEqual([]);
  });

  test('план без названия подписан нейтрально', () => {
    expect(exportHeader({ ...demo, name: '   ' }).title).toBe('План без названия');
  });
});
