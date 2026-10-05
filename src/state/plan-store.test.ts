/**
 * S01 acceptance, part two: the single editing state. One gesture is one undo
 * step, dirty compares content against the export baseline, and a failed
 * command leaves the document untouched.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import type { PlanDocument, Zone } from '../contracts/model';
import { COMMAND_ISSUE_CODES } from '../domain/commands';
import { VALIDATION_ISSUE_CODES } from '../domain/validation';
import { parsePlanDocument } from '../contracts/schema';
import { createPlanStore, type PlanStoreApi } from './plan-store';

function minimalPlan(): PlanDocument {
  const path = join(process.cwd(), 'src', 'contracts', 'fixtures', 'minimal.json');
  const parsed = parsePlanDocument(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  if (!parsed.ok) throw new Error('fixture minimal.json не проходит схему');
  return parsed.value;
}

const bowtiePolygon: Zone['polygon'] = [
  [0, 0],
  [7, 8],
  [7, 0],
  [0, 8],
];

let store: PlanStoreApi;

beforeEach(() => {
  store = createPlanStore(minimalPlan());
});

describe('открытие документа', () => {
  test('план из файла открывается чистым', () => {
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().document.objects[0]!.zoneId).toBe('z_client');
  });

  test('новый и восстановленный черновик считаются несохранёнными', () => {
    const fresh = minimalPlan();
    store.getState().replaceDocument(fresh, 'new');
    expect(store.getState().dirty).toBe(true);
    expect(store.getState().baseline).toBe(fresh);

    const draft = minimalPlan();
    store.getState().replaceDocument(draft, 'draft');
    expect(store.getState().dirty).toBe(true);
    expect(store.getState().baseline).toBe(draft);

    const file = minimalPlan();
    store.getState().replaceDocument(file, 'file');
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().baseline).toBe(file);
  });

  test('импорт сохраняет заявленные связи до первой команды', () => {
    const claimed = minimalPlan();
    // Связь заявлена файлом и геометрией не подтверждается: до первой команды
    // store её не переписывает.
    claimed.objects[0] = { ...claimed.objects[0]!, position: [9, 4], zoneId: 'z_client' };

    store.getState().replaceDocument(claimed, 'file');

    expect(store.getState().document.objects[0]!.zoneId).toBe('z_client');
  });
});

describe('undo и redo', () => {
  test('undo перемещения возвращает и геометрию, и zoneId', () => {
    const before = store.getState().document.objects[0]!;

    store.getState().dispatch({
      type: 'object.put',
      object: { ...before, position: [9, 4] },
    });
    expect(store.getState().document.objects[0]!.zoneId).toBeNull();

    store.getState().undo();

    expect(store.getState().document.objects[0]!.position).toEqual(before.position);
    expect(store.getState().document.objects[0]!.zoneId).toBe('z_client');
  });

  test('redo возвращает отменённый жест', () => {
    const before = store.getState().document.objects[0]!;
    store.getState().dispatch({ type: 'object.put', object: { ...before, position: [3, 3] } });
    store.getState().undo();

    store.getState().redo();

    expect(store.getState().document.objects[0]!.position).toEqual([3, 3]);
  });

  test('каждый удачный шаг поднимает revision, undo и redo тоже', () => {
    const start = store.getState().revision;
    const before = store.getState().document.objects[0]!;

    store.getState().dispatch({ type: 'object.put', object: { ...before, position: [3, 3] } });
    const afterDispatch = store.getState().revision;
    store.getState().undo();
    const afterUndo = store.getState().revision;
    store.getState().redo();

    expect(afterDispatch).toBeGreaterThan(start);
    expect(afterUndo).toBeGreaterThan(afterDispatch);
    expect(store.getState().revision).toBeGreaterThan(afterUndo);
  });

  test('новый жест после undo обрезает redo', () => {
    const before = store.getState().document.objects[0]!;
    store.getState().dispatch({ type: 'object.put', object: { ...before, position: [3, 3] } });
    store.getState().undo();

    store.getState().dispatch({ type: 'object.put', object: { ...before, position: [4, 4] } });
    store.getState().redo();

    expect(store.getState().document.objects[0]!.position).toEqual([4, 4]);
  });

  test('undo и redo на пустой истории ничего не делают', () => {
    const revision = store.getState().revision;

    store.getState().undo();
    store.getState().redo();

    expect(store.getState().revision).toBe(revision);
    expect(store.getState().dirty).toBe(false);
  });

  test('открытие другого документа сбрасывает историю: undo не уводит в прошлый файл', () => {
    const before = store.getState().document.objects[0]!;
    store.getState().dispatch({ type: 'object.put', object: { ...before, position: [3, 3] } });

    const other = minimalPlan();
    other.name = 'Другой план';
    store.getState().replaceDocument(other, 'file');
    store.getState().undo();

    expect(store.getState().document.name).toBe('Другой план');
  });
});

describe('ошибка команды', () => {
  test('отклонённая команда не меняет ни документ, ни revision, ни историю', () => {
    const snapshot = store.getState().document;
    const revision = store.getState().revision;

    const result = store.getState().dispatch({
      type: 'object.put',
      object: { ...snapshot.objects[0]!, layerId: 'l_missing' },
    });

    expect(result.ok).toBe(false);
    expect(store.getState().document).toBe(snapshot);
    expect(store.getState().revision).toBe(revision);
    expect(store.getState().dirty).toBe(false);
  });

  test('запертый слой отклоняет правку через store', () => {
    const base = store.getState().document;
    store.getState().dispatch({
      type: 'layer.put',
      layer: { ...base.layers[0]!, locked: true },
    });

    const result = store.getState().dispatch({
      type: 'object.put',
      object: { ...base.objects[0]!, position: [3, 3] },
    });

    expect(result.ok).toBe(false);
    expect(store.getState().document.objects[0]!.position).toEqual(base.objects[0]!.position);
  });

  test('удалённый id не переиспользуется', () => {
    store.getState().dispatch({ type: 'object.delete', id: 'eq_work_1' });

    const result = store.getState().dispatch({
      type: 'object.put',
      object: { ...minimalPlan().objects[0]!, position: [3, 3] },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.code)).toContain(COMMAND_ISSUE_CODES.ID_REUSED);
  });

  test('удалённые id видны снаружи, чтобы инструменты их не выдавали', () => {
    expect(store.getState().retired.size).toBe(0);
    store.getState().dispatch({ type: 'object.delete', id: 'eq_work_1' });
    expect(store.getState().retired.has('eq_work_1')).toBe(true);
    // Новый документ — новая история: набор пуст.
    store.getState().replaceDocument(minimalPlan(), 'file');
    expect(store.getState().retired.size).toBe(0);
  });

  test('перестроение контура не воскрешает id удалённой перегородки', () => {
    const boundary = store.getState().document.room.boundary;
    const [a, b] = [boundary[0]!, boundary[1]!];
    const partition = store.getState().dispatch({
      type: 'wall.put',
      wall: { id: 'w_1', from: [a[0] + 1, a[1] + 1], to: [b[0] - 1, a[1] + 1], thickness_m: 0.1, height_m: 3 },
    });
    if (!partition.ok) throw new Error(partition.issues.map((issue) => issue.message).join('; '));
    store.getState().dispatch({ type: 'wall.delete', id: 'w_1' });
    expect(store.getState().retired.has('w_1')).toBe(true);

    const [x0, y0] = a;
    const pentagon: [number, number][] = [[x0, y0], [x0 + 10, y0], [x0 + 10, y0 + 8], [x0 + 5, y0 + 10], [x0, y0 + 8]];
    const result = store.getState().dispatch({ type: 'room.set', boundary: pentagon });
    if (!result.ok) throw new Error(result.issues.map((issue) => issue.message).join('; '));
    expect(result.value.walls.map((wall) => wall.id)).not.toContain('w_1');
  });

  test('после undo удаления та же сущность снова редактируема', () => {
    store.getState().dispatch({ type: 'object.delete', id: 'eq_work_1' });
    store.getState().undo();

    const result = store.getState().dispatch({
      type: 'object.put',
      object: { ...store.getState().document.objects[0]!, position: [3, 3] },
    });

    expect(result.ok).toBe(true);
    expect(store.getState().document.objects[0]!.position).toEqual([3, 3]);
  });
});

describe('dirty и подготовка экспорта', () => {
  test('видимость слоя и её undo/redo не устаревают содержимое для ассистента', () => {
    const layer = store.getState().document.layers[0]!;
    const contentRevision = store.getState().contentRevision;
    const revision = store.getState().revision;
    store.getState().dispatch({ type: 'layer.put', layer: { ...layer, visible: !layer.visible } });
    expect(store.getState().revision).toBeGreaterThan(revision);
    expect(store.getState().contentRevision).toBe(contentRevision);
    expect(store.getState().document.layers[0]!.visible).toBe(!layer.visible);
    store.getState().undo();
    expect(store.getState().document.layers[0]!.visible).toBe(layer.visible);
    expect(store.getState().contentRevision).toBe(contentRevision);
    store.getState().redo();
    expect(store.getState().document.layers[0]!.visible).toBe(!layer.visible);
    expect(store.getState().contentRevision).toBe(contentRevision);

    const object = store.getState().document.objects[0]!;
    store.getState().dispatch({ type: 'object.put', object: { ...object, position: [3, 3] } });
    const changed = store.getState().contentRevision;
    expect(changed).toBeGreaterThan(contentRevision);
    store.getState().undo();
    expect(store.getState().contentRevision).toBeGreaterThan(changed);
    const beforeReplace = store.getState().contentRevision;
    store.getState().replaceDocument(store.getState().document, 'file');
    expect(store.getState().contentRevision).toBeGreaterThan(beforeReplace);
  });

  test('markExported актуальной revision снимает dirty, устаревшая игнорируется', () => {
    const initialBaseline = store.getState().baseline;
    const before = store.getState().document.objects[0]!;
    store.getState().dispatch({ type: 'object.put', object: { ...before, position: [3, 3] } });
    expect(store.getState().dirty).toBe(true);

    const stale = store.getState().revision - 1;
    store.getState().markExported(stale);
    expect(store.getState().dirty).toBe(true);
    expect(store.getState().baseline).toBe(initialBaseline);

    store.getState().markExported(store.getState().revision);
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().baseline).toBe(store.getState().document);
  });

  test('показать или скрыть слой — не правка: dirty не поднимается, а переименование слоя — поднимает (D-207)', () => {
    const layer = store.getState().document.layers[0]!;
    const hidden = store.getState().dispatch({ type: 'layer.put', layer: { ...layer, visible: !layer.visible } });
    expect(hidden.ok).toBe(true);
    expect(store.getState().revision).toBeGreaterThan(0);
    expect(store.getState().dirty).toBe(false);

    store.getState().dispatch({ type: 'layer.put', layer: { ...layer, visible: !layer.visible, name: 'Иное имя' } });
    expect(store.getState().dirty).toBe(true);
    store.getState().undo();
    expect(store.getState().dirty).toBe(false);
    // Видимость в документе всё же осталась переключённой: в файл она попадёт.
    expect(store.getState().document.layers[0]!.visible).toBe(!layer.visible);
  });

  test('подготовка экспорта не меняет revision, но снимает dirty', () => {
    const before = store.getState().document.objects[0]!;
    store.getState().dispatch({ type: 'object.put', object: { ...before, position: [3, 3] } });
    const revision = store.getState().revision;
    expect(store.getState().dirty).toBe(true);

    store.getState().markExported(revision);

    expect(store.getState().revision).toBe(revision);
    expect(store.getState().dirty).toBe(false);
  });

  test('после markExported новый baseline работает с историей: undo к нему делает грязным', () => {
    const before = store.getState().document.objects[0]!;
    store.getState().dispatch({ type: 'object.put', object: { ...before, position: [3, 3] } });
    store.getState().markExported(store.getState().revision);

    // Откат к состоянию до экспорта — это уже расхождение с выгруженным файлом.
    store.getState().undo();
    expect(store.getState().dirty).toBe(true);

    store.getState().redo();
    expect(store.getState().dirty).toBe(false);
  });

  test('undo назад к baseline снимает dirty, шаг вперёд снова его ставит', () => {
    const before = store.getState().document.objects[0]!;
    store.getState().dispatch({ type: 'object.put', object: { ...before, position: [3, 3] } });

    store.getState().undo();
    expect(store.getState().dirty).toBe(false);

    store.getState().redo();
    expect(store.getState().dirty).toBe(true);
  });

  test('dirty сравнивает содержимое: возврат к прежним значениям другой командой тоже чист', () => {
    const before = store.getState().document.objects[0]!;
    store.getState().dispatch({ type: 'object.put', object: { ...before, position: [3, 3] } });
    store.getState().dispatch({ type: 'object.put', object: before });

    expect(store.getState().dirty).toBe(false);
  });
});

describe('выбор', () => {
  test('select не считается правкой документа', () => {
    const revision = store.getState().revision;

    store.getState().select({ kind: 'object', id: 'eq_work_1' });

    expect(store.getState().selection).toEqual({ kind: 'object', id: 'eq_work_1' });
    expect(store.getState().revision).toBe(revision);
    expect(store.getState().dirty).toBe(false);
  });

  test('выбор удалённого объекта сбрасывается', () => {
    store.getState().select({ kind: 'object', id: 'eq_work_1' });

    store.getState().dispatch({ type: 'object.delete', id: 'eq_work_1' });

    expect(store.getState().selection).toBeNull();
  });

  test('выбор удалённой зоны сбрасывается', () => {
    store.getState().select({ kind: 'zone', id: 'z_client' });

    store.getState().dispatch({ type: 'zone.delete', id: 'z_client' });

    expect(store.getState().selection).toBeNull();
  });

  test('выбор несуществующей ссылки не принимается', () => {
    store.getState().select({ kind: 'object', id: 'eq_nope' });

    expect(store.getState().selection).toBeNull();
  });

  test('ссылка нужного id, но другого вида не принимается', () => {
    store.getState().select({ kind: 'zone', id: 'eq_work_1' });

    expect(store.getState().selection).toBeNull();
  });
});

describe('состояние при создании', () => {
  test('новый план и черновик стартуют несохранёнными, файл — чистым', () => {
    expect(createPlanStore(minimalPlan(), 'new').getState().dirty).toBe(true);
    expect(createPlanStore(minimalPlan(), 'draft').getState().dirty).toBe(true);
    expect(createPlanStore(minimalPlan(), 'file').getState().dirty).toBe(false);
    // Значение по умолчанию — файл: store над разобранным документом чист.
    expect(createPlanStore(minimalPlan()).getState().dirty).toBe(false);
  });

  test('у нового плана markExported снимает dirty без открытия файла', () => {
    const fresh = createPlanStore(minimalPlan(), 'new');

    fresh.getState().markExported(fresh.getState().revision);

    expect(fresh.getState().dirty).toBe(false);
  });
});

describe('обязательный сценарий S01: промежуточное неверное состояние не теряет жест', () => {
  test('валидный план → самопересечение зоны → исправление → undo по всем снимкам', () => {
    const valid = store.getState().document;
    expect(valid.objects[0]!.zoneId).toBe('z_client');

    // Жест 1: зона превращается в самопересекающуюся. Документ сохраняется,
    // но связи обнуляются: угадывать зону по невычислимой геометрии нельзя.
    const broken = store.getState().dispatch({
      type: 'zone.put',
      zone: { ...valid.zones[0]!, polygon: bowtiePolygon },
    });
    expect(broken.ok).toBe(true);
    expect(store.getState().document.zones[0]!.polygon).toEqual(bowtiePolygon);
    expect(store.getState().document.objects[0]!.zoneId).toBeNull();

    // Жест 2: следующая корректная команда восстанавливает связи автоматически.
    store.getState().dispatch({
      type: 'zone.put',
      zone: { ...valid.zones[0]!, polygon: valid.zones[0]!.polygon },
    });
    expect(store.getState().document.objects[0]!.zoneId).toBe('z_client');

    // Undo возвращает каждый предыдущий снимок, включая неверный.
    store.getState().undo();
    expect(store.getState().document.zones[0]!.polygon).toEqual(bowtiePolygon);
    expect(store.getState().document.objects[0]!.zoneId).toBeNull();

    store.getState().undo();
    expect(store.getState().document.zones[0]!.polygon).toEqual(valid.zones[0]!.polygon);
    expect(store.getState().document.objects[0]!.zoneId).toBe('z_client');
    expect(store.getState().dirty).toBe(false);
  });
});

describe('групповой выбор и пакет команд', () => {
  const copyOf = (id: string, dx: number) => {
    const source = store.getState().document.objects[0]!;
    return { ...source, id, position: [source.position[0] + dx, source.position[1]] as [number, number] };
  };
  const ids = () => [...store.getState().selected].sort();

  test('select — это группа из одного объекта; зона и «ничего» дают пустую группу', () => {
    store.getState().select({ kind: 'object', id: 'eq_work_1' });
    expect(ids()).toEqual(['eq_work_1']);

    store.getState().select({ kind: 'zone', id: 'z_client' });
    expect(ids()).toEqual([]);

    store.getState().select(null);
    expect(ids()).toEqual([]);
  });

  test('selectMany оставляет только объекты документа, главным становится последний', () => {
    store.getState().dispatch({ type: 'object.put', object: copyOf('eq_a', 2) });
    const revision = store.getState().revision;
    const dirty = store.getState().dirty;

    store.getState().selectMany(['eq_work_1', 'z_client', 'eq_nope', 'eq_a', 'eq_work_1']);

    expect(ids()).toEqual(['eq_a', 'eq_work_1']);
    expect(store.getState().selection).toEqual({ kind: 'object', id: 'eq_work_1' });
    expect(store.getState().revision).toBe(revision);
    expect(store.getState().dirty).toBe(dirty);
  });

  test('selectMany без живых объектов сбрасывает и главный выбор', () => {
    store.getState().select({ kind: 'object', id: 'eq_work_1' });
    store.getState().selectMany(['eq_nope']);
    expect(store.getState().selection).toBeNull();
    expect(ids()).toEqual([]);
  });

  test('группа не переживает удаление своих объектов, а нетронутая группа остаётся той же ссылкой', () => {
    store.getState().dispatch({ type: 'object.put', object: copyOf('eq_a', 2) });
    store.getState().selectMany(['eq_work_1', 'eq_a']);
    const before = store.getState().selected;

    store.getState().dispatch({ type: 'plan.rename', name: 'Другое' });
    expect(store.getState().selected).toBe(before);

    store.getState().dispatch({ type: 'object.delete', id: 'eq_a' });
    expect(ids()).toEqual(['eq_work_1']);
    expect(store.getState().selection).toEqual({ kind: 'object', id: 'eq_work_1' });
  });

  test('replaceDocument очищает группу', () => {
    store.getState().select({ kind: 'object', id: 'eq_work_1' });
    store.getState().replaceDocument(minimalPlan(), 'file');
    expect(ids()).toEqual([]);
  });

  test('пакет — один шаг истории: групповой перенос отменяется одним undo', () => {
    store.getState().dispatch({ type: 'object.put', object: copyOf('eq_a', 2) });
    const beforeMove = store.getState().document;

    const result = store.getState().dispatch({
      type: 'batch',
      commands: [
        { type: 'object.put', object: copyOf('eq_work_1', 1) },
        { type: 'object.put', object: { ...copyOf('eq_a', 3), id: 'eq_a' } },
      ],
    });
    expect(result.ok).toBe(true);
    expect(store.getState().document.objects.map((object) => object.position[0])).not.toEqual(
      beforeMove.objects.map((object) => object.position[0]),
    );

    store.getState().undo();
    expect(store.getState().document).toBe(beforeMove);
  });

  test('отказ шага пакета не оставляет следа: документ, revision и история прежние', () => {
    const snapshot = store.getState().document;
    const revision = store.getState().revision;

    const result = store.getState().dispatch({
      type: 'batch',
      commands: [
        { type: 'object.put', object: copyOf('eq_a', 2) },
        { type: 'object.delete', id: 'eq_missing' },
      ],
    });

    expect(result.ok).toBe(false);
    expect(store.getState().document).toBe(snapshot);
    expect(store.getState().revision).toBe(revision);
    store.getState().undo();
    expect(store.getState().document).toBe(snapshot);
  });

  test('групповое удаление выводит id из оборота: повторный put любого из них — ID_REUSED', () => {
    store.getState().dispatch({ type: 'object.put', object: copyOf('eq_a', 2) });
    const original = store.getState().document.objects[0]!;

    store.getState().dispatch({
      type: 'batch',
      commands: [
        { type: 'object.delete', id: 'eq_work_1' },
        { type: 'object.delete', id: 'eq_a' },
      ],
    });
    expect(store.getState().document.objects).toEqual([]);
    expect([...store.getState().retired].sort()).toEqual(['eq_a', 'eq_work_1']);

    const reuse = store.getState().dispatch({
      type: 'batch',
      commands: [{ type: 'object.put', object: { ...original, id: 'eq_a' } }],
    });
    expect(reuse.ok).toBe(false);
    if (!reuse.ok) expect(reuse.issues.map((issue) => issue.code)).toContain(COMMAND_ISSUE_CODES.ID_REUSED);
  });
});

describe('физика — граница правки (D-286)', () => {
  const source = () => store.getState().document.objects[0]!;

  test('объект нельзя поставить в объём другого: документ не меняется', () => {
    const before = store.getState().document;
    const revision = store.getState().revision;

    const result = store.getState().dispatch({
      type: 'object.put',
      object: { ...source(), id: 'eq_chair', label: 'Стул', height_m: 0.9 },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]!.code).toBe(VALIDATION_ISSUE_CODES.OBJECT_COLLISION);
      expect(result.issues[0]!.message).toContain('одно место');
    }
    expect(store.getState().document).toBe(before);
    expect(store.getState().revision).toBe(revision);
    expect(store.getState().dirty).toBe(false);
  });

  test('вывеску нельзя поднять выше потолка', () => {
    const result = store.getState().dispatch({
      type: 'object.put',
      object: { ...source(), base_m: 2.8, height_m: 0.4 },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]!.code).toBe(VALIDATION_ISSUE_CODES.OBJECT_ABOVE_CEILING);
    expect(store.getState().document.objects[0]!.base_m).toBe(0);
  });

  test('пакет отклоняется целиком: ни одна его часть не остаётся', () => {
    const result = store.getState().dispatch({
      type: 'batch',
      commands: [
        { type: 'object.put', object: { ...source(), id: 'eq_far', position: [8, 2] } },
        { type: 'object.put', object: { ...source(), id: 'eq_chair', height_m: 0.9 } },
      ],
    });

    expect(result.ok).toBe(false);
    expect(store.getState().document.objects.map((object) => object.id)).toEqual(['eq_work_1']);
  });

  test('свободное место и высота под потолком проходят', () => {
    const free = store.getState().dispatch({
      type: 'object.put',
      object: { ...source(), id: 'eq_free', position: [5, 5] },
    });
    expect(free.ok).toBe(true);

    const camera = store.getState().dispatch({
      type: 'object.put',
      object: { ...source(), id: 'eq_camera', base_m: 2.6, height_m: 0.2 },
    });
    expect(camera.ok).toBe(true);
    expect(store.getState().document.objects).toHaveLength(3);
  });
});

describe('варианты А и Б (#38)', () => {
  const moveTo = (position: [number, number]): void => {
    const object = store.getState().document.objects[0]!;
    store.getState().dispatch({ type: 'object.put', object: { ...object, position } });
  };

  test('«Запомнить как вариант»: правки идут в Б, Б не сохранён, А чист', () => {
    store.getState().keepVariant();

    expect(store.getState().variants).toEqual({ active: 'Б', otherDirty: false });
    expect(store.getState().dirty).toBe(true);
  });

  test('переключение не теряет правок и не смешивает undo', () => {
    moveTo([3, 3]);
    store.getState().keepVariant();
    moveTo([9, 4]);

    store.getState().switchVariant();
    expect(store.getState().variants).toEqual({ active: 'А', otherDirty: true });
    expect(store.getState().document.objects[0]!.position).toEqual([3, 3]);
    store.getState().redo();
    expect(store.getState().document.objects[0]!.position).toEqual([3, 3]);

    moveTo([4, 4]);
    store.getState().switchVariant();
    expect(store.getState().document.objects[0]!.position).toEqual([9, 4]);
    store.getState().undo();
    expect(store.getState().document.objects[0]!.position).toEqual([3, 3]);

    store.getState().switchVariant();
    expect(store.getState().document.objects[0]!.position).toEqual([4, 4]);
    store.getState().undo();
    expect(store.getState().document.objects[0]!.position).toEqual([3, 3]);
  });

  test('сохранение одного варианта не делает чистым другой', () => {
    moveTo([3, 3]);
    store.getState().keepVariant();
    store.getState().markExported(store.getState().revision);
    expect(store.getState().dirty).toBe(false);

    store.getState().switchVariant();
    expect(store.getState().dirty).toBe(true);
    expect(store.getState().variants).toEqual({ active: 'А', otherDirty: false });
  });

  test('replaceDocument убирает второй вариант', () => {
    store.getState().keepVariant();
    store.getState().replaceDocument(minimalPlan(), 'file');

    expect(store.getState().variants).toBeNull();
  });
});
