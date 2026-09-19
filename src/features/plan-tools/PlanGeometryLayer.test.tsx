// @vitest-environment jsdom
/**
 * Q02 (D-187 для геометрии плана): слой зон, стен и проёмов не должен
 * рисоваться через буферный холст Konva.
 *
 * Полупрозрачная фигура с заливкой и обводкой по умолчанию рисуется в
 * отдельный холст размером со сцену и копируется целиком: одна очистка и один
 * `drawImage` на фигуру при каждой перерисовке слоя — zoom, панорама,
 * перетаскивание, открытие файла. Заливка зоны — ровно такой случай.
 *
 * Тест закрепляет причину, а не время, и смотрит слой целиком: новая
 * полупрозрачная фигура с заливкой и обводкой уронит его, не дожидаясь замера.
 */

import { readFileSync } from 'node:fs';
import { cleanup, render } from '@testing-library/react';
import type Konva from 'konva';
import { createRef } from 'react';
import { Stage } from 'react-konva';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import type { PlanDocument, Ref } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import type { EditorSession } from '../../contracts/ui';
import { PlanGeometryLayer } from './PlanGeometryLayer';

afterEach(cleanup);

beforeAll(() => {
  const result = { width: 0, data: new Uint8ClampedArray(4), addColorStop: () => undefined };
  const context = new Proxy(
    {},
    { get: (_target, key) => (key === 'canvas' ? undefined : () => result) },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => context as CanvasRenderingContext2D,
  );
});
afterAll(() => {
  vi.restoreAllMocks();
});

/** Демо-план: восемь зон, стены и проёмы настоящего отделения. */
function demo(): PlanDocument {
  const parsed = parsePlanDocument(JSON.parse(readFileSync('demo/before.json', 'utf8')));
  if (!parsed.ok) throw new Error('demo/before.json не разобрался');
  return parsed.value;
}

function drawnShapes(plan: PlanDocument, selection: Ref | null): Konva.Shape[] {
  const stage = createRef<Konva.Stage>();
  const session: EditorSession = {
    tool: { kind: 'select' },
    viewport: { origin: [0, 0], scale: 48 },
    selection,
    preview: null,
    focus: null,
  };
  render(
    <Stage ref={stage} width={800} height={600}>
      <PlanGeometryLayer
        document={plan}
        session={session}
        draft={null}
        onCommand={() => ({ ok: true, value: plan })}
        onSelect={() => undefined}
      />
    </Stage>,
  );
  if (stage.current === null) throw new Error('Stage не смонтировался');
  return stage.current.find((node: Konva.Node) => 'hasFill' in node) as Konva.Shape[];
}

describe('геометрия плана рисуется без буферного холста', () => {
  const plan = demo();
  const firstZone = plan.zones[0];
  if (firstZone === undefined) throw new Error('в демо нет зон');

  for (const [name, selection] of [
    ['ничего не выбрано', null],
    ['выбрана зона — у неё появляются ручки вершин', { kind: 'zone', id: firstZone.id } as Ref],
  ] as const) {
    test(`${name}: ни одна фигура не идёт через буфер`, () => {
      const shapes = drawnShapes(plan, selection);
      expect(shapes.length).toBeGreaterThan(0);

      const buffered = shapes.filter((shape) => shape._useBufferCanvas());
      expect(buffered.map((shape) => shape.getClassName())).toEqual([]);
    });
  }

  test('случай, ради которого буфер существует, в слое действительно есть', () => {
    const shapes = drawnShapes(plan, null);
    const translucentFilled = shapes.filter(
      (shape) => shape.getAbsoluteOpacity() < 1 && shape.hasFill() && shape.hasStroke(),
    );
    expect(translucentFilled.length).toBeGreaterThan(0);
  });
});
