/** Contract gate for the two schema-bound conversational model calls. */

import { describe, expect, test } from 'vitest';
import type { Fact, Recommendation } from './advice';
import { verifyChatIntent, verifyChatSelection } from './advice-chat';
import { SCHEMA_VERSION, type PlanDocument } from './model';

const plan: PlanDocument = {
  schemaVersion: SCHEMA_VERSION,
  id: 'plan_chat',
  name: 'План чата',
  room: {
    id: 'room_main',
    boundary: [[0, 0], [10, 0], [10, 8], [0, 8]],
    ceilingHeight_m: 3,
  },
  walls: [],
  openings: [],
  layers: [
    { id: 'l_base', name: 'Основной', visible: true, locked: false, order: 0, typeId: null },
  ],
  zones: [
    {
      id: 'z_client',
      typeId: 'zt_client',
      name: 'Клиентская зона',
      polygon: [[0, 0], [10, 0], [10, 8], [0, 8]],
      parentId: null,
      layerId: 'l_base',
      attributes: {},
    },
  ],
  objects: [
    {
      id: 'eq_work_1',
      typeId: 'ot_workplace',
      label: 'Рабочее место 1',
      position: [2, 2],
      size_m: [1.4, 0.8],
      rotation_deg: 0,
      base_m: 0,
      height_m: 0.75,
      zoneId: 'z_client',
      layerId: 'l_base',
      attributes: {},
    },
  ],
  catalog: {
    version: 'chat-test',
    objectTypes: [
      {
        id: 'ot_workplace',
        label: 'Рабочее место',
        category: 'Обслуживание',
        defaultSize_m: [1.4, 0.8],
        defaultHeight_m: 0.75,
        defaultBase_m: 0,
        physical: true,
        occupiesFloor: true,
        symbol: 'rect',
        color: '#4C6EF5',
        attributes: [],
        provenance: 'Синтетический тестовый тип.',
      },
    ],
    zoneTypes: [{ id: 'zt_client', label: 'Клиентская', color: '#E7F5FF', attributes: [] }],
    layerTypes: [],
    rules: [],
  },
  extensions: {},
};

const fact: Fact = {
  id: 'f1',
  metric: 'area.free',
  phase: 'current',
  value: 70,
  unit: 'm2',
  refs: [{ kind: 'zone', id: 'z_client' }],
};

const candidateFact: Fact = {
  ...fact,
  id: 'f_candidate_1',
  phase: 'after',
};

const recommendations: Recommendation[] = [
  {
    id: 'r1',
    scenario: 'place',
    refs: [{ kind: 'zone', id: 'z_client' }],
    candidates: [
      {
        id: 'c1',
        object: { ...plan.objects[0]!, id: 'candidate_object' },
        facts: [candidateFact],
      },
    ],
    facts: [fact, candidateFact],
    ruleIds: [],
    assumptions: [],
    reasonCodes: ['placement.available'],
    limitations: [],
    changes: [],
  },
  {
    id: 'r2',
    scenario: 'place',
    refs: [{ kind: 'zone', id: 'z_client' }],
    candidates: [
      {
        id: 'c2',
        object: { ...plan.objects[0]!, id: 'candidate_object_2' },
        facts: [],
      },
    ],
    facts: [],
    ruleIds: [],
    assumptions: [],
    reasonCodes: ['placement.available'],
    limitations: [],
    changes: [],
  },
];

describe('чат: намерение модели', () => {
  test('принимает сценарий только с id из текущего плана', () => {
    expect(
      verifyChatIntent(
        {
          kind: 'request',
          request: { scenario: 'place', typeId: 'ot_workplace', zoneId: null },
          preference: 'ближе к входу',
        },
        plan,
      ),
    ).toMatchObject({ ok: true });

    expect(
      verifyChatIntent(
        {
          kind: 'request',
          request: { scenario: 'place', typeId: 'invented', zoneId: null },
          preference: '',
        },
        plan,
      ),
    ).toMatchObject({ ok: false });
  });

  test('отклоняет лишнее числовое поле и свободный текст вне узкой формы', () => {
    expect(
      verifyChatIntent({ kind: 'clarify', question: 'Уточните зону', confidence: 0.9 }, plan),
    ).toMatchObject({ ok: false });
    expect(
      verifyChatIntent({ kind: 'clarify', question: 'Уточните зону', answer: 'поставьте стол' }, plan),
    ).toMatchObject({ ok: false });
  });
});

describe('чат: выбор из расчёта', () => {
  test('принимает только факты, кандидатов и действия текущего расчёта', () => {
    expect(
      verifyChatSelection(
        {
          selections: [
            {
              recommendationId: 'r1',
              factIds: ['f1', 'f_candidate_1'],
              actions: [
                { kind: 'focus', ref: { kind: 'object', id: 'eq_work_1' } },
                { kind: 'open-properties', objectId: 'eq_work_1' },
                { kind: 'filter-inventory', typeId: 'ot_workplace', zoneId: 'z_client' },
                { kind: 'show-layer', layerId: 'l_base' },
                { kind: 'preview-candidate', recommendationId: 'r1', candidateId: 'c1' },
              ],
            },
          ],
        },
        recommendations,
        plan,
      ),
    ).toMatchObject({ ok: true });
  });

  test('отклоняет неизвестные id, чужого кандидата и лишнее поле', () => {
    expect(
      verifyChatSelection(
        {
          selections: [
            {
              recommendationId: 'r1',
              factIds: ['f1'],
              actions: [{ kind: 'focus', ref: { kind: 'object', id: 'invented' } }],
            },
          ],
        },
        recommendations,
        plan,
      ),
    ).toMatchObject({ ok: false });

    expect(
      verifyChatSelection(
        {
          selections: [
            {
              recommendationId: 'r1',
              factIds: ['f1'],
              actions: [{ kind: 'focus', ref: { kind: 'layer', id: 'l_base' } }],
            },
          ],
        },
        recommendations,
        plan,
      ),
    ).toMatchObject({ ok: false });

    expect(
      verifyChatSelection(
        {
          selections: [
            {
              recommendationId: 'r1',
              factIds: ['f_candidate_1'],
              actions: [{ kind: 'preview-candidate', recommendationId: 'r1', candidateId: 'c2' }],
            },
          ],
        },
        recommendations,
        plan,
      ),
    ).toMatchObject({ ok: false });

    expect(
      verifyChatSelection(
        {
          selections: [],
          measuredFreeArea: 70,
        },
        recommendations,
        plan,
      ),
    ).toMatchObject({ ok: false });
  });
});
