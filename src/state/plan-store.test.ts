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
    store.getState().replaceDocument(minimalPlan(), 'new');
    expect(store.getState().dirty).toBe(true);

    store.getState().replaceDocument(minimalPlan(), 'draft');
    expect(store.getState().dirty).toBe(true);

    store.getState().replaceDocument(minimalPlan(), 'file');
    expect(store.getState().dirty).toBe(false);
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
  test('markExported актуальной revision снимает dirty, устаревшая игнорируется', () => {
    const before = store.getState().document.objects[0]!;
    store.getState().dispatch({ type: 'object.put', object: { ...before, position: [3, 3] } });
    expect(store.getState().dirty).toBe(true);

    const stale = store.getState().revision - 1;
    store.getState().markExported(stale);
    expect(store.getState().dirty).toBe(true);

    store.getState().markExported(store.getState().revision);
    expect(store.getState().dirty).toBe(false);
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
