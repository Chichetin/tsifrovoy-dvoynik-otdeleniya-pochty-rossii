/**
 * #59: a 3D model repeats the object's position, rotation, size and height.
 * These are the rules a picture does not prove: where a leg ends up on a
 * longer desk, how many shelves a lower rack gets, which corner a turned
 * model stands on.
 */

import { describe, expect, test } from 'vitest';
import type { Equipment, ObjectType, PlanDocument, Zone } from '../../contracts/model';
import { footprint } from '../../domain/geometry';
import { fitPositions, track, type Fit } from './model-fit';
import { buildScene } from './scene';

const DESK: Fit = { fit: 'slice', size: [1.4, 0.8, 0.75], margins: [0.1, 0.48, 0.06, 0.06, 0, 0.035] };

describe('подгонка модели под размер', () => {
  test('резиновая середина: край стола сохраняет размер, габарит равен новому', () => {
    // A leg 4 cm from the left edge and the pedestal 3 cm from the right edge.
    const [fitted] = fitPositions([-0.66, 0, 0, 0.67, 0, 0.75, -0.7, -0.4, 0, 0.7, 0.4, 0.75], DESK, [2.4, 0.8, 0.9]);
    expect(Array.from(fitted!).map((value) => Number(value.toFixed(4)))).toEqual([
      -1.16, 0, 0, 1.17, 0, 0.9, -1.2, -0.4, 0, 1.2, 0.4, 0.9,
    ]);
  });

  test('вписывание: прибор сохраняет пропорции и стоит на основании', () => {
    const printer: Fit = { fit: 'contain', size: [0.5, 0.45, 0.4] };
    // Half the width: one scale 0.5 on all three axes, not a narrow printer.
    const [fitted] = fitPositions([0.25, 0.225, 0.4], printer, [0.25, 0.45, 0.4]);
    expect(Array.from(fitted!)).toEqual([0.125, 0.1125, 0.2].map(Math.fround));
  });

  test('повтор: у стеллажа ниже полок меньше с тем же шагом, на верхней полке посылок нет', () => {
    const shelves: [number, number, number] = [0.08, 0.05, 0.4675];
    expect(track(shelves, 2)).toHaveLength(5);
    expect(track(shelves, 1.2)).toHaveLength(3);
    const rack: Fit = { fit: 'slice', size: [1.2, 0.5, 2], margins: [0.06, 0.06, 0.04, 0.04, 0.12, 0.04] };
    const parcels = fitPositions([-0.3, 0, 0.2], rack, [1.2, 0.5, 1.2], { x: [0.3, 0.3, 0.6], z: shelves, skipTop: true });
    // Two cells across, two shelves of three get parcels: 4 copies.
    expect(parcels).toHaveLength(4);
  });
});

describe('модель на плане', () => {
  test('повёрнутая модель стоит углом в угол своего следа', () => {
    const type = { id: 'ot_desk', model3d: 'workplace', symbol: 'rect' } as ObjectType;
    const desk = {
      id: 'eq_1', typeId: 'ot_desk', label: 'Стол', position: [3, 2], size_m: [1.4, 0.8], rotation_deg: 37,
      base_m: 0, height_m: 0.75, layerId: 'l_1',
    } as Equipment;
    const plan = {
      room: { id: 'r', boundary: [[0, 0], [6, 0], [6, 6]], ceilingHeight_m: 3 },
      zones: [], walls: [], openings: [], objects: [desk],
      layers: [{ id: 'l_1', visible: true }],
      catalog: { objectTypes: [type], zoneTypes: [], layerTypes: [] },
    } as unknown as PlanDocument;

    const model = buildScene(plan).prisms.find((prism) => prism.kind === 'object')?.model;
    if (model === undefined) throw new Error('у объекта нет модели');
    // Model corner (W/2, D/2) through the scene's axes lands on a footprint corner.
    const corner = [0, 1].map((i) => model.center[i]! + model.xAxis[i]! * 0.7 + model.yAxis[i]! * 0.4);
    const corners = footprint(desk).map(([x, y]) => [Number(x.toFixed(9)), Number(y.toFixed(9))]);
    expect(corners).toContainEqual(corner.map((value) => Number(value.toFixed(9))));
  });
});

describe('слой тепла на полу', () => {
  const heatType = {
    id: 'lt_heat',
    representation: { kind: 'zone-heat', attribute: 'load', unit: '%', max: 100, colors: ['#000000', '#FFFFFF'] },
  };
  const zone = (id: string, parentId: string | null, attributes: Zone['attributes']) =>
    ({ id, name: id, typeId: 'zt', parentId, layerId: 'l_base', polygon: [[0, 0], [4, 0], [4, 4]], attributes }) as unknown as Zone;
  const planWith = (heatVisible: boolean) =>
    ({
      room: { id: 'r', boundary: [[0, 0], [6, 0], [6, 6]], ceilingHeight_m: 3 },
      zones: [zone('z_hall', null, { load: 50 }), zone('z_desk', 'z_hall', {})],
      walls: [], openings: [], objects: [],
      layers: [
        { id: 'l_base', typeId: '', visible: true, order: 0 },
        { id: 'l_heat', typeId: 'lt_heat', visible: heatVisible, order: 1 },
      ],
      catalog: { objectTypes: [], zoneTypes: [{ id: 'zt', color: '#123456' }], layerTypes: [heatType] },
    }) as unknown as PlanDocument;
  const colors = (plan: PlanDocument) =>
    Object.fromEntries(buildScene(plan).prisms.filter((prism) => prism.kind === 'zone').map((prism) => [prism.ref.id, prism.color]));

  test('зона без значения берёт цвет и число ближайшего родителя, скрытый слой цвет не меняет', () => {
    expect(colors(planWith(true))).toEqual({ z_hall: '#808080', z_desk: '#808080' });
    expect(buildScene(planWith(true)).labels.map((label) => label.value)).toEqual(['50\u00A0%', '50\u00A0%']);
    expect(colors(planWith(false))).toEqual({ z_hall: '#123456', z_desk: '#123456' });
    expect(buildScene(planWith(false)).labels.map((label) => label.value)).toEqual([undefined, undefined]);
  });
});
