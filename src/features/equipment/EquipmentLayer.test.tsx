// @vitest-environment jsdom
/**
 * Q02 (D-182): selecting one object among a thousand must not cost seconds.
 *
 * Every click redraws the equipment layer. A Konva shape that is translucent
 * and has both fill and stroke is, by default, painted through a stage-sized
 * buffer canvas: one clear and one full-canvas `drawImage` per object. On 1000
 * objects that was 0.9 s per click on a production build (software canvas,
 * Linux) — the whole of the measured delay. The test pins the cause, not a
 * timing: every equipment symbol, in every variant the layer draws, is painted
 * straight onto the layer canvas.
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

function drawnSymbols(plan: PlanDocument, selection: Ref | null, preview: Candidate | null): Konva.Shape[] {
  const stage = createRef<Konva.Stage>();
  const session: EditorSession = {
    tool: { kind: 'select' },
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
  // The symbol is the only child of the group that carries the object's name;
  // the selection layer is also named `equipment-…`, hence the class check.
  return stage.current
    .find((node: Konva.Node) => node.getClassName() === 'Group' && node.name().startsWith('equipment-'))
    .map((group) => (group as Konva.Group).getChildren()[0] as Konva.Shape);
}

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
