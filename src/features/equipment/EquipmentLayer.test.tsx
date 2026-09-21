// @vitest-environment jsdom
/**
 * Q02 (D-187): zooming on a thousand objects must not cost seconds.
 *
 * After D-177 a click no longer redraws the equipment layer, but zoom, pan,
 * drag and open still do. A Konva shape that is translucent and has both
 * fill and stroke is, by default, painted through a stage-sized buffer
 * canvas: one clear and one full-canvas `drawImage` per object, on every one
 * of those redraws. The test pins the cause, not a timing: every equipment
 * symbol, in every variant the layer draws, is painted straight onto the
 * layer canvas.
 */

import { cleanup, render } from '@testing-library/react';
import type Konva from 'konva';
import { createRef } from 'react';
import { Stage } from 'react-konva';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import nested from '../../contracts/fixtures/nested.json';
import type { Candidate } from '../../contracts/advice';
import type { ObjectSymbol, PlanDocument, Ref } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import type { EditorSession } from '../../contracts/ui';
import { EquipmentLayer } from './EquipmentLayer';

afterEach(cleanup);

// jsdom has no 2D context. Konva only needs one to exist here: nothing is
// looked at on screen, the test reads the shapes' own attributes. Every
// method is a no-op; the results Konva reads are `measureText().width` and
// `getImageData().data` (its hit-colour probe).
beforeAll(() => {
  const context = new Proxy(
    {},
    { get: (_target, key) => (key === 'canvas' ? undefined : () => ({ width: 0, data: new Uint8ClampedArray(4) })) },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => context as CanvasRenderingContext2D,
  );
});
afterAll(() => {
  vi.restoreAllMocks();
});

function planWith(symbol: ObjectSymbol): PlanDocument {
  const parsed = parsePlanDocument(nested);
  if (!parsed.ok) throw new Error('nested.json не разобрался');
  const plan = parsed.value;
  return {
    ...plan,
    catalog: {
      ...plan.catalog,
      objectTypes: plan.catalog.objectTypes.map((type) => ({ ...type, symbol })),
    },
  };
}

function renderLayer(
  plan: PlanDocument,
  selection: Ref | null,
  preview: Candidate | null,
  tool: EditorSession['tool'] = { kind: 'select' },
): Konva.Stage {
  const stage = createRef<Konva.Stage>();
  const session: EditorSession = {
    tool,
    viewport: { origin: [0, 0], scale: 48 },
    selection,
    preview,
    focus: null,
  };
  render(
    <Stage ref={stage} width={800} height={600}>
      <EquipmentLayer
        document={plan}
        session={session}
        onCommand={() => ({ ok: true, value: plan })}
        onSelect={() => undefined}
        preview={preview}
      />
    </Stage>,
  );
  if (stage.current === null) throw new Error('Stage не смонтировался');
  return stage.current;
}

function drawnSymbols(plan: PlanDocument, selection: Ref | null, preview: Candidate | null): Konva.Shape[] {
  // The symbol is the only child of the group that carries the object's name;
  // the selection layer is also named `equipment-…`, hence the class check.
  return renderLayer(plan, selection, preview)
    .find((node: Konva.Node) => node.getClassName() === 'Group' && node.name().startsWith('equipment-'))
    .map((group) => (group as Konva.Group).getChildren()[0] as Konva.Shape);
}

/** Имена ручек выбранного объекта на слое выделения. */
function handleNames(plan: PlanDocument, objectId: string): string[] {
  return renderLayer(plan, { kind: 'object', id: objectId }, null)
    .find((node: Konva.Node) => node.name().startsWith('handle-'))
    .map((node) => node.name());
}

/** Тот же план, но тип объекта `typeId` повешен на стену: высоко и не на полу. */
function mountedOnWall(plan: PlanDocument, typeId: string): PlanDocument {
  return {
    ...plan,
    catalog: {
      ...plan.catalog,
      objectTypes: plan.catalog.objectTypes.map((type) =>
        type.id === typeId ? { ...type, occupiesFloor: false, defaultBase_m: 2.6 } : type,
      ),
    },
  };
}

describe('ручки выбранного объекта', () => {
  test('мебель тянется за восемь ручек размера и поворачивается', () => {
    const plan = planWith('rect');
    expect(handleNames(plan, 'eq_bench_1').sort()).toEqual([
      'handle-resize-e',
      'handle-resize-n',
      'handle-resize-ne',
      'handle-resize-nw',
      'handle-resize-s',
      'handle-resize-se',
      'handle-resize-sw',
      'handle-resize-w',
      'handle-rotate',
    ]);
  });

  test('настенный прибор (D-228) поворачивается, но не растягивается', () => {
    const plan = mountedOnWall(planWith('rect'), 'ot_bench');
    expect(handleNames(plan, 'eq_bench_1')).toEqual(['handle-rotate']);
    // Соседний тип остался мебелью: запрет адресный, а не «всем без ручек».
    expect(handleNames(plan, 'eq_work_1')).toHaveLength(9);
  });
});

describe('перетаскивание объекта', () => {
  const draggable = (tool: EditorSession['tool']): boolean[] =>
    renderLayer(planWith('rect'), null, null, tool)
      .find((node: Konva.Node) => node.getClassName() === 'Group' && node.name().startsWith('equipment-'))
      .map((group) => group.draggable());

  test('под «Выбором» объект тянется', () => {
    expect(draggable({ kind: 'select' })).toContain(true);
  });

  test('под линейкой (D-256) протяжка не двигает объект — измерение не меняет план', () => {
    expect(draggable({ kind: 'measure' })).not.toContain(true);
  });
});

describe('символ оборудования рисуется без буферного холста', () => {
  for (const symbol of ['rect', 'circle', 'triangle'] as const) {
    test(`${symbol}: обычный, выбранный и призрак рекомендации`, () => {
      const plan = planWith(symbol);
      const first = plan.objects[0];
      if (first === undefined) throw new Error('В фикстуре нет объектов');
      const ghost: Candidate = {
        id: 'cand_1',
        object: { ...first, id: 'eq_candidate', position: [1, 1] },
        facts: [],
      };
      const shapes = drawnSymbols(plan, { kind: 'object', id: first.id }, ghost);

      // Every object plus the ghost: nothing escaped the check.
      expect(shapes).toHaveLength(plan.objects.length + 1);
      for (const shape of shapes) {
        // The case the buffer exists for is really present: translucent,
        // filled and stroked.
        expect(shape.getAbsoluteOpacity()).toBeLessThan(1);
        expect(shape.hasFill()).toBe(true);
        expect(shape.hasStroke()).toBe(true);
        expect(shape._useBufferCanvas()).toBe(false);
      }
    });
  }
});
