// @vitest-environment jsdom
/**
 * Issue #32 (D-307): blind spots of client zones are hatched on the plan while
 * the camera layer is on, and the coverage is counted once per document
 * revision — a pan or zoom redraws the strips without counting again.
 */

import { readFileSync } from 'node:fs';
import { cleanup, render } from '@testing-library/react';
import type Konva from 'konva';
import { createRef } from 'react';
import { Layer, Stage } from 'react-konva';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { PlanDocument } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import type { EditorSession } from '../../contracts/ui';
import { InformationLayer } from './InformationLayer';
import { visibleCoverage } from './coverage';

vi.mock('./coverage', async (original) => {
  const real = await original<typeof import('./coverage')>();
  return { ...real, visibleCoverage: vi.fn(real.visibleCoverage) };
});

afterEach(cleanup);
// Braces matter: a function returned from beforeEach is run as its cleanup.
beforeEach(() => {
  vi.mocked(visibleCoverage).mockClear();
});

// jsdom has no 2D context; Konva only needs one to exist (same stub as InformationLayer.test.tsx).
beforeAll(() => {
  const result = { width: 0, data: new Uint8ClampedArray(4), addColorStop: () => undefined };
  const context = new Proxy({}, { get: (_target, key) => (key === 'canvas' ? undefined : () => result) });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context as CanvasRenderingContext2D);
});
afterAll(() => {
  vi.restoreAllMocks();
});

function demo(visible: string[]): PlanDocument {
  const parsed = parsePlanDocument(JSON.parse(readFileSync('demo/before.json', 'utf8')));
  if (!parsed.ok) throw new Error('demo/before.json');
  return {
    ...parsed.value,
    layers: parsed.value.layers.map((layer) => ({ ...layer, visible: layer.typeId === null || visible.includes(layer.id) })),
  };
}

const session = (scale: number): EditorSession => ({
  tool: { kind: 'select' },
  viewport: { origin: [0, 0], scale },
  selection: null,
  preview: null,
  focus: null,
});

function stageWith(plan: PlanDocument, scale = 48) {
  const stage = createRef<Konva.Stage>();
  const view = render(
    <Stage ref={stage} width={900} height={700}>
<Layer>
      <InformationLayer document={plan} session={session(scale)} />
</Layer>
    </Stage>,
  );
  if (stage.current === null) throw new Error('Stage');
  const rerender = (next: PlanDocument, nextScale: number): void =>
    view.rerender(
      <Stage ref={stage} width={900} height={700}>
<Layer>
        <InformationLayer document={next} session={session(nextScale)} />
</Layer>
      </Stage>,
    );
  return { stage: stage.current, rerender };
}

const named = (stage: Konva.Stage, name: string): Konva.Node[] => stage.find((node: Konva.Node) => node.name() === name);

describe('слепые пятна клиентских зон на холсте', () => {
  test('слой камер включён: штриховка и строка легенды с долей видимого', () => {
    const { stage } = stageWith(demo(['l_lt_cameras']));
    expect(named(stage, 'camera-blind')).toHaveLength(1);
    expect(named(stage, 'camera-blind-legend')).toHaveLength(1);
    const captions = named(stage, 'info-caption').map((node) => (node as Konva.Text).text());
    expect(captions).toContain('Слепые пятна клиентских зон · видно 93,8 %');
    // Hatch is a plain fill without stroke or opacity: no buffer canvas (D-190).
    const hatch = named(stage, 'camera-blind')[0] as Konva.Shape;
    expect(hatch._useBufferCanvas()).toBe(false);
  });

  test('слой камер выключен — штриховки нет, расчёт не нужен', () => {
    const { stage } = stageWith(demo(['l_lt_heat']));
    expect(named(stage, 'camera-blind')).toHaveLength(0);
    expect(named(stage, 'camera-blind-legend')).toHaveLength(0);
  });

  test('всё видно — штриховки нет, но доля в легенде есть', () => {
    const plan = demo(['l_lt_cameras']);
    const wide = {
      ...plan,
      objects: plan.objects.map((object) =>
        object.id === 'eq_26' ? { ...object, attributes: { ...object.attributes, viewAngleDeg: 360, viewRangeM: 20 } } : object,
      ),
    };
    const { stage } = stageWith(wide);
    expect(named(stage, 'camera-blind')).toHaveLength(0);
    const captions = named(stage, 'info-caption').map((node) => (node as Konva.Text).text());
    expect(captions).toContain('Слепые пятна клиентских зон · видно 100 %');
  });

  test('масштаб и панорама не пересчитывают покрытие, новая ревизия — пересчитывает', () => {
    const plan = demo(['l_lt_cameras']);
    const { stage, rerender } = stageWith(plan, 48);
    expect(vi.mocked(visibleCoverage)).toHaveBeenCalledTimes(1);
    const firstWidth = (named(stage, 'camera-blind')[0] as Konva.Shape).width();
    expect(firstWidth).toBeGreaterThan(0);

    rerender(plan, 96);
    rerender(plan, 30);
    expect(vi.mocked(visibleCoverage)).toHaveBeenCalledTimes(1);
    // The strips follow the viewport even though nothing was counted again.
    expect((named(stage, 'camera-blind')[0] as Konva.Shape).width()).toBeCloseTo((firstWidth * 30) / 48, 6);

    const moved = { ...plan, objects: plan.objects.map((object) => (object.id === 'eq_25' ? { ...object, rotation_deg: 180 } : object)) };
    rerender(moved, 30);
    expect(vi.mocked(visibleCoverage)).toHaveBeenCalledTimes(2);
  });
});
