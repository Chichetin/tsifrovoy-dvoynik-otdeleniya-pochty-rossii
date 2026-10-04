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
import { cleanup, fireEvent, render } from '@testing-library/react';
import type Konva from 'konva';
import { createRef } from 'react';
import { Layer, Stage } from 'react-konva';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import type { PlanDocument, Ref } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import type { EditorSession, Tool } from '../../contracts/ui';
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
<Layer>
      <PlanGeometryLayer
        document={plan}
        session={session}
        draft={null}
        onCommand={() => ({ ok: true, value: plan })}
        onSelect={() => undefined}
      />
</Layer>
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

/** Тот же слой, но с управляемыми инструментом, выбором и черновиком —
 * для проверки Enter и смены инструмента (D-267). */
function renderLayer(
  plan: PlanDocument,
  opts: { tool?: Tool; selection?: Ref | null; draft?: [number, number][] | null },
): { onSelect: ReturnType<typeof vi.fn>; rerender: (next: Partial<typeof opts>) => void } {
  const onSelect = vi.fn();
  const stage = createRef<Konva.Stage>();
  const session = (o: typeof opts): EditorSession => ({
    tool: o.tool ?? { kind: 'select' },
    viewport: { origin: [0, 0], scale: 48 },
    selection: o.selection ?? null,
    preview: null,
    focus: null,
  });
  const view = render(
    <Stage ref={stage} width={800} height={600}>
<Layer>
      <PlanGeometryLayer
        document={plan}
        session={session(opts)}
        draft={opts.draft ?? null}
        onCommand={() => ({ ok: true, value: plan })}
        onSelect={onSelect}
      />
</Layer>
    </Stage>,
  );
  return {
    onSelect,
    rerender: (next) => {
      const merged = { ...opts, ...next };
      view.rerender(
        <Stage ref={stage} width={800} height={600}>
<Layer>
          <PlanGeometryLayer
            document={plan}
            session={session(merged)}
            draft={merged.draft ?? null}
            onCommand={() => ({ ok: true, value: plan })}
            onSelect={onSelect}
          />
</Layer>
        </Stage>,
      );
    },
  };
}

describe('Enter и смена инструмента завершают выделенный проём (D-267)', () => {
  const plan = demo();
  const opening: Ref = { kind: 'opening', id: 'op_entrance' };

  test('Enter при выделенном проёме снимает выделение', () => {
    const { onSelect } = renderLayer(plan, { selection: opening });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  test('Enter в поле ввода проём не трогает', () => {
    const { onSelect } = renderLayer(plan, { selection: opening });
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).not.toHaveBeenCalled();
    input.remove();
  });

  test('при черновике контура Enter не снимает выделение проёма', () => {
    const { onSelect } = renderLayer(plan, {
      selection: opening,
      draft: [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
    });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onSelect).not.toHaveBeenCalled();
  });

  test('Enter при выделенной зоне проём не снимает и её тоже не трогает', () => {
    const zone = plan.zones[0];
    if (zone === undefined) throw new Error('в демо нет зон');
    const { onSelect } = renderLayer(plan, { selection: { kind: 'zone', id: zone.id } });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onSelect).not.toHaveBeenCalled();
  });

  test('смена инструмента снимает выделение с проёма', () => {
    const { onSelect, rerender } = renderLayer(plan, { tool: { kind: 'select' }, selection: opening });
    rerender({ tool: { kind: 'zone.draw' } });
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  test('тот же инструмент не снимает выделение: смены не было', () => {
    const { onSelect, rerender } = renderLayer(plan, { tool: { kind: 'select' }, selection: opening });
    rerender({ tool: { kind: 'select' } });
    expect(onSelect).not.toHaveBeenCalled();
  });

  test('смена инструмента при выделенной зоне её не трогает — правило только про проём', () => {
    const zone = plan.zones[0];
    if (zone === undefined) throw new Error('в демо нет зон');
    const { onSelect, rerender } = renderLayer(plan, {
      tool: { kind: 'select' },
      selection: { kind: 'zone', id: zone.id },
    });
    rerender({ tool: { kind: 'wall.draw' } });
    expect(onSelect).not.toHaveBeenCalled();
  });
});
