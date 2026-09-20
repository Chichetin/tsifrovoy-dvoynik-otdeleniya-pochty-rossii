// @vitest-environment jsdom
/**
 * Q02 (D-187 для информационных слоёв): слой не должен рисоваться через
 * буферный холст Konva.
 *
 * Полупрозрачная фигура с заливкой и обводкой по умолчанию рисуется в
 * отдельный холст размером со сцену, а потом копируется целиком: одна очистка
 * и один `drawImage` на фигуру при каждой перерисовке слоя — zoom, панорама,
 * перетаскивание, открытие файла. У оборудования это закрыто в D-187, у
 * информационных слоёв осталось.
 *
 * Тест закрепляет причину, а не время, и смотрит слой целиком: новая фигура
 * с полупрозрачностью, заливкой и обводкой уронит его, не дожидаясь замера.
 */

import { readFileSync } from 'node:fs';
import { cleanup, render } from '@testing-library/react';
import type Konva from 'konva';
import { createRef } from 'react';
import { Stage } from 'react-konva';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import type { PlanDocument } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import type { EditorSession } from '../../contracts/ui';
import { boundingBox, footprint, modelToScreen } from '../../domain/geometry';
import { InformationLayer } from './InformationLayer';
import { boxesOverlap, captionBox, type Box } from './label-layout';

afterEach(cleanup);

// jsdom не даёт 2D-контекста. Konva достаточно, чтобы он существовал: на
// экран здесь никто не смотрит, тест читает атрибуты самих фигур.
beforeAll(() => {
  // Konva читает из результатов только `measureText().width`, данные пробы
  // `getImageData()` и градиент легенды, которому нужен `addColorStop`.
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

/** Демо-план: восемь зон, 53 объекта и все четыре типа информационных слоёв. */
function demoWithLayersOn(): PlanDocument {
  const parsed = parsePlanDocument(JSON.parse(readFileSync('demo/before.json', 'utf8')));
  if (!parsed.ok) throw new Error('demo/before.json не разобрался');
  const plan = parsed.value;
  return { ...plan, layers: plan.layers.map((layer) => ({ ...layer, visible: true })) };
}

const VIEWPORT = { origin: [0, 0] as [number, number], scale: 48 };

function drawnShapes(plan: PlanDocument, viewport = VIEWPORT): Konva.Shape[] {
  const stage = createRef<Konva.Stage>();
  const session: EditorSession = {
    tool: { kind: 'select' },
    viewport,
    selection: null,
    preview: null,
    focus: null,
  };
  render(
    <Stage ref={stage} width={800} height={600}>
      <InformationLayer document={plan} session={session} />
    </Stage>,
  );
  if (stage.current === null) throw new Error('Stage не смонтировался');
  return stage.current.find((node: Konva.Node) => node instanceof Object && 'hasFill' in node) as Konva.Shape[];
}

/** Подписи объектов, которые рисует слой оборудования: их места заняты. */
function captionBoxes(plan: PlanDocument, viewport = VIEWPORT): Box[] {
  const visible = new Set(plan.layers.filter((layer) => layer.visible).map((layer) => layer.id));
  return plan.objects.flatMap((object) => {
    if (!visible.has(object.layerId)) return [];
    const box = boundingBox(footprint(object));
    const caption = captionBox(
      modelToScreen(object.position, viewport),
      (box.maxX - box.minX) * viewport.scale,
      (box.maxY - box.minY) * viewport.scale,
      object.label,
    );
    return caption === null ? [] : [caption];
  });
}

describe('информационные слои рисуются без буферного холста', () => {
  test('все четыре слоя включены: ни одна фигура не идёт через буфер', () => {
    const shapes = drawnShapes(demoWithLayersOn());
    expect(shapes.length).toBeGreaterThan(0);

    const buffered = shapes.filter((shape) => shape._useBufferCanvas());
    expect(
      buffered.map((shape) => `${shape.getClassName()} ${shape.name() || shape.id() || '—'}`),
    ).toEqual([]);
  });

  test('случай, ради которого буфер существует, в слое действительно есть', () => {
    // Иначе первый тест зелёный по недоразумению: нечего было проверять.
    const shapes = drawnShapes(demoWithLayersOn());
    const translucentFilled = shapes.filter(
      (shape) => shape.getAbsoluteOpacity() < 1 && shape.hasFill() && shape.hasStroke(),
    );
    expect(translucentFilled.length).toBeGreaterThan(0);
  });
});

describe('подписи слоёв не садятся на подписи объектов (находка operator №9)', () => {
  test('ни одна метка слоя не накрывает название объекта', () => {
    const plan = demoWithLayersOn();
    const labels = drawnShapes(plan)
      .filter((shape) => shape.name() === 'info-label')
      .map((shape) => ({ x: shape.x(), y: shape.y(), width: shape.width(), height: shape.height() }));
    expect(labels.length).toBeGreaterThan(0);

    const covered = labels.filter((label) =>
      captionBoxes(plan).some((caption) => boxesOverlap(label, caption)),
    );
    expect(covered).toEqual([]);
  });
});
