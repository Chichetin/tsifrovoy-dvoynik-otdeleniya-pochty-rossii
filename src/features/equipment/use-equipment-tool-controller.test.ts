// @vitest-environment jsdom
/**
 * D-310: a click with an armed library type puts one object, and that object
 * already carries the next inventory number of the plan's series — in the same
 * `object.put`, so one undo takes back both.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Command } from '../../contracts/commands';
import type { Equipment, PlanDocument, Point, Result } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import type { EditorSession } from '../../contracts/ui';
import { useEquipmentToolController } from './use-equipment-tool-controller';

function demoBefore(): PlanDocument {
  const raw = JSON.parse(readFileSync(join(process.cwd(), 'demo', 'before.json'), 'utf8')) as unknown;
  const parsed = parsePlanDocument(raw);
  if (!parsed.ok) throw new Error('demo/before.json не проходит схему');
  return parsed.value;
}

function place(plan: PlanDocument, typeId: string, point: Point): Command[] {
  const commands: Command[] = [];
  const onCommand = (command: Command): Result<PlanDocument> => {
    commands.push(command);
    return { ok: true, value: plan };
  };
  const session: EditorSession = {
    tool: { kind: 'object.place', typeId },
    viewport: { origin: [0, 0], scale: 50 },
    selection: null,
    preview: null,
    focus: null,
  };
  const hook = renderHook(() => useEquipmentToolController({ document: plan, session, onCommand }));
  act(() =>
    hook.result.current.handlePointer({ phase: 'down', point, shift: false, alt: false, button: 0 }),
  );
  return commands;
}

function placed(commands: Command[]): Equipment {
  expect(commands).toHaveLength(1);
  const [command] = commands;
  if (command?.type !== 'object.put') throw new Error('ожидалась одна команда object.put');
  return command.object;
}

afterEach(cleanup);

describe('постановка из библиотеки выдаёт инвентарный номер (D-310)', () => {
  it('скамья на демо-плане получает ИНВ-ДЕМО-054 той же командой', () => {
    const object = placed(place(demoBefore(), 'ot_bench', [2.2, 2]));
    expect(object.id).toBe('eq_54');
    expect(object.attributes.inventoryNumber).toBe('ИНВ-ДЕМО-054');
  });

  it('на плане без номеров начинается серия команды ИНВ-0001', () => {
    const plan = { ...demoBefore(), objects: [] };
    expect(placed(place(plan, 'ot_workplace', [2.2, 2])).attributes.inventoryNumber).toBe('ИНВ-0001');
  });

  it('нефизическая отметка (розетка) номер не получает', () => {
    const object = placed(place(demoBefore(), 'ot_socket', [2.2, 2]));
    expect(object.attributes.inventoryNumber ?? null).toBeNull();
  });
});
