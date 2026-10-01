import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PlanDocument, Wall } from '../../contracts/model';
import { applyCommand } from '../../domain/commands';
import { createInternalRoom, roomRectangle, snapRoomCorner } from './internal-room';
const wall = (id: string, from: [number, number], to: [number, number]): Wall => ({ id, from, to, thickness_m: 0.1, height_m: 3 });
function plan(): PlanDocument {
  const p = JSON.parse(readFileSync('demo/after.json', 'utf8')) as PlanDocument;
  return { ...p, room: { ...p.room, boundary: roomRectangle([0, 0], [12, 9]) }, objects: [], zones: [],
    walls: [wall('south', [0, 0], [12, 0]), wall('east', [12, 0], [12, 9]), wall('north', [12, 9], [0, 9]), wall('west', [0, 9], [0, 0])], openings: [] };
}
describe('прямоугольная внутренняя комната', () => {
  it('сохраняет внешний контур и все старые стены; добавляет перегородки и зону атомарно', () => {
    const p = plan(); const draft = createInternalRoom(p, roomRectangle([1, 1], [4, 4]));
    expect(draft.ok).toBe(true); if (!draft.ok) return;
    expect(draft.walls).toHaveLength(4);
    const result = applyCommand(p, draft.command); expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.value.room).toEqual(p.room);
    expect(result.value.walls.slice(0, p.walls.length)).toEqual(p.walls);
    expect(result.value.zones).toHaveLength(1);
  });
  it('пристёгивает к наружному углу без дублирования двух стен', () => {
    const p = plan(); const draft = createInternalRoom(p, roomRectangle([0, 0], [4, 4]));
    expect(draft.ok).toBe(true); if (!draft.ok) return;
    expect(draft.walls).toHaveLength(2);
  });
  it('сохраняет частично общую стену и дорисовывает только её непокрытый отрезок', () => {
    const p = plan(); p.walls.push(wall('shared', [4, 0], [4, 2]));
    const draft = createInternalRoom(p, roomRectangle([0, 0], [4, 4]));
    expect(draft.ok).toBe(true); if (!draft.ok) return;
    expect(draft.walls).toContainEqual(expect.objectContaining({ from: [4, 2], to: [4, 4] }));
  });
  it('вторая комната рядом использует стену первой, перекрывающая — отклоняется', () => {
    const p = plan(); const first = createInternalRoom(p, roomRectangle([0, 0], [4, 4]));
    if (!first.ok) throw new Error(first.message);
    const result = applyCommand(p, first.command); if (!result.ok) throw new Error('Команда отказала');
    const next = createInternalRoom(result.value, roomRectangle([4, 0], [8, 4]));
    expect(next.ok).toBe(true); if (next.ok) expect(next.walls).toHaveLength(2);
    expect(createInternalRoom(result.value, roomRectangle([3, 1], [6, 5])).ok).toBe(false);
  });
  it('отказывает за внешним контуром, при слишком малом размере и повторном контуре', () => {
    const p = plan();
    expect(createInternalRoom(p, roomRectangle([-1, 0], [4, 4])).ok).toBe(false);
    expect(createInternalRoom(p, roomRectangle([0, 0], [0.1, 4])).ok).toBe(false);
    expect(createInternalRoom(p, p.room.boundary).ok).toBe(false);
  });
  it('не пересекает твёрдое оборудование новой стеной', () => {
    const p = plan(); const demo = JSON.parse(readFileSync('demo/after.json', 'utf8')) as PlanDocument;
    p.objects = [{ ...demo.objects[0]!, position: [4, 2], size_m: [1, 1], rotation_deg: 0, base_m: 0, height_m: 1 }];
    expect(createInternalRoom(p, roomRectangle([0, 0], [4, 4])).ok).toBe(false);
  });
  it('притягивает к оси стены, сохраняет прямой угол и учитывает толщину', () => {
    const p = plan();
    expect(snapRoomCorner([0.05, 0.05], p.walls, 0.1)).toEqual([0, 0]);
    expect(snapRoomCorner([2, 2], p.walls, 0.1)).toEqual([2, 2]);
  });
});

it('не допускает наложение толщины близкой параллельной стены и перекрытие проёма', () => {
  const p = plan(); p.walls.push(wall('near', [4.04, 0], [4.04, 4]));
  expect(createInternalRoom(p, roomRectangle([0, 0], [4, 4])).ok).toBe(false);
  p.walls.pop();
  p.openings.push({ id: 'door', wallId: 'south', offset_m: 3.5, width_m: 1.5, kind: 'entrance', sill_m: 0, height_m: 2.1 });
  expect(createInternalRoom(p, roomRectangle([0, 0], [4, 4])).ok).toBe(false);
});

it('общий конец не оправдывает длинное наложение почти параллельных стен', () => {
  const p = plan(); p.walls.push(wall('slanted', [4, 0], [4.04, 3.9]));
  expect(createInternalRoom(p, roomRectangle([0, 0], [4, 4])).ok).toBe(false);
});
