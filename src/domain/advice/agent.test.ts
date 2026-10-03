/**
 * D-258: the check of the model's text in the plan agent, on the demo plan the
 * jury opens first. The rest of the agent tests were cut by D-351.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { PlanDocument } from '../../contracts/model';
import { parsePlanDocument } from '../../contracts/schema';
import { agentEvidence, checkAgentText, createAgentToolState, runAgentTool } from './index';

function load(path: string): PlanDocument {
  const parsed = parsePlanDocument(JSON.parse(readFileSync(join(process.cwd(), path), 'utf8')));
  if (!parsed.ok) throw new Error(`${path} не разобрался`);
  return parsed.value;
}

const before = load('demo/before.json');

describe('проверка текста модели', () => {
  function evidenceFor(): ReturnType<typeof agentEvidence> {
    const state = createAgentToolState(before, null);
    const overview = runAgentTool(state, 'plan_overview', {}).output;
    return agentEvidence(state, [overview], 'Сколько свободно?');
  }
  const overview = runAgentTool(createAgentToolState(before, null), 'plan_overview', {}).output as {
    room: { free_m2: number; total_m2: number };
  };

  test('числа и id из результатов проходят, включая округление и запятую', () => {
    const free = overview.room.free_m2;
    const text = `В помещении свободно ${String(free).replace('.', ',')} м² (около ${Math.round(free)} м²), зона z_client.`;
    expect(checkAgentText(text, evidenceFor())).toEqual([]);
  });

  test('выдуманное число и несуществующий id отвергаются', () => {
    const problems = checkAgentText('Свободно 999,7 м², объект eq_9999 лишний.', evidenceFor());
    expect(problems).toEqual([
      { kind: 'unknown-id', token: 'eq_9999' },
      { kind: 'unknown-number', token: '999,7' },
    ]);
  });

  test('цифры внутри id не считаются числами', () => {
    expect(checkAgentText('Посмотрите eq_12 и eq_13.', evidenceFor())).toEqual([]);
  });
});
