import { expect, it } from 'vitest';
import type { Opening, Wall } from '../../contracts/model';
import { introducesOpeningOverlap, resizeOpening } from './opening-edit';
const wall: Wall = { id: 'wall', from: [0, 0], to: [6, 0], thickness_m: 0.2, height_m: 3 };
const opening: Opening = { id: 'door', wallId: wall.id, offset_m: 2, width_m: 1, sill_m: 0, height_m: 2.1, kind: 'door' };
it('край проёма перемещается по стене, противоположный край сохраняется', () => {
  expect(resizeOpening(opening, wall, 'start', [1, 5])).toEqual({ ...opening, offset_m: 1, width_m: 2 });
  expect(resizeOpening(opening, wall, 'end', [4, -5])).toEqual({ ...opening, width_m: 2 });
});
it('за край стены не выходит, пересечение ручек не даёт отрицательную ширину', () => {
  const start = resizeOpening(opening, wall, 'start', [5, 0]);
  expect(start.offset_m + start.width_m).toBeCloseTo(3); expect(start.width_m).toBeCloseTo(0.2);
  expect(resizeOpening(opening, wall, 'end', [9, 0]).width_m).toBe(4);
  expect(resizeOpening(opening, wall, 'start', [-4, 0]).offset_m).toBe(0);
});
it('работает на вертикальной стене с обратным направлением', () => {
  expect(resizeOpening(opening, { ...wall, from: [0, 6], to: [0, 0] }, 'end', [10, 2]).width_m).toBe(2);
});
it('отказывает в новом наложении, но допускает касание и правку прежнего наложения', () => {
  const other = { ...opening, id: 'other', offset_m: 4 };
  expect(introducesOpeningOverlap({ ...opening, width_m: 3 }, opening, [opening, other])).toBe(true);
  expect(introducesOpeningOverlap({ ...opening, width_m: 2 }, opening, [opening, other])).toBe(false);
  expect(introducesOpeningOverlap({ ...opening, width_m: 3 }, { ...opening, width_m: 3 }, [other])).toBe(false);
  expect(introducesOpeningOverlap({ ...opening, width_m: 3 }, opening, [{ ...other, sill_m: 2.5, height_m: 0.3 }])).toBe(false);
});

it('прежнее наложение можно уменьшать, но нельзя увеличивать по ширине или высоте', () => {
  const before={...opening,width_m:2,height_m:1};
  const other={...opening,id:'other',offset_m:3,width_m:2,height_m:2};
  expect(introducesOpeningOverlap({...before,width_m:2.5},before,[before,other])).toBe(true);
  expect(introducesOpeningOverlap({...before,height_m:1.5},before,[other])).toBe(true);
  expect(introducesOpeningOverlap({...before,width_m:1.5},before,[other])).toBe(false);
  expect(introducesOpeningOverlap({...before,height_m:0.5},before,[other])).toBe(false);
  expect(introducesOpeningOverlap({...before,kind:'window'},before,[other])).toBe(false);
  expect(introducesOpeningOverlap({...before,width_m:2.5},before,[{...other,wallId:'another-wall'}])).toBe(false);
});

it('уменьшение общей суммы не разрешает усилить пересечение с отдельным соседом', () => {
  const before={...opening,offset_m:1,width_m:3};
  const left={...opening,id:'left',offset_m:0,width_m:2};
  const right={...opening,id:'right',offset_m:3.5,width_m:2};
  expect(introducesOpeningOverlap({...before,offset_m:1.7,width_m:2.5},before,[left,right])).toBe(true);
});

it('возвращает импортированный проём вне стены в её границы', () => {
  const invalid = { ...opening, offset_m: 8 };
  const end = resizeOpening(invalid, wall, 'end', [6, 0]);
  expect(end.offset_m + end.width_m).toBeCloseTo(6); expect(end.width_m).toBeCloseTo(0.2);
  expect(resizeOpening(invalid, wall, 'start', [5, 0])).toEqual({ ...invalid, offset_m: 5, width_m: 1 });
});

it('минимальная ширина не сдвигает противоположный край узкого импортированного проёма', () => {
  const atEnd={ ...opening, offset_m: 5.9, width_m: 0.1 };
  expect(resizeOpening(atEnd, wall, 'end', [5.95,0]).offset_m).toBe(5.9);
  const atStart={ ...opening, offset_m: 0, width_m: 0.1 };
  const resized=resizeOpening(atStart,wall,'start',[0,0]);
  expect(resized.offset_m+resized.width_m).toBeCloseTo(0.1);
});
