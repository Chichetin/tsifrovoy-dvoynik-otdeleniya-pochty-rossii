/**
 * #33: «Почему?» for one finding of the plan check.
 *
 * The explanation is read from data, not written per rule: a finding with
 * `ruleIds` shows that catalog rule — its rationale, source and every
 * parameter of the record — so a new rule in `data/catalog/rules.json` gets
 * its explanation without a line here. A physics finding shows its entry of
 * `PHYSICS_RULES`. Only the structural checks of `domain/validation` have no
 * description record in domain; for them a short local table stands in.
 *
 * The fix variant is the assistant's own placement search
 * (`findPlacements`): the code finds the spot and checks it with the same
 * `validatePlan`; nothing is invented in the panel.
 */

import type { Candidate } from '../../contracts/advice';
import type { Equipment, Id, Issue, PlanDocument, Point, Rule } from '../../contracts/model';
import { findPlacements } from '../../domain/advice';
import { findObjectType, findZoneType } from '../../domain/catalog';
import { objectsInZoneScope } from '../../domain/inventory';
import { openingCentre } from '../../domain/geometry';
import { formatShort } from '../../domain/number-format';
import { PHYSICS_RULES } from '../../domain/physics';
import { RELATION_ISSUE_CODES } from '../../domain/relations';
import { VALIDATION_ISSUE_CODES, type ValidationIssue } from '../../domain/validation';

export type WhyParam = { label: string; value: string };

export type FindingWhy = {
  title: string;
  /** What the check compares and where its number comes from. */
  method: string;
  /** Rationale of a catalog rule, as written in the catalog. */
  rationale: string | null;
  params: WhyParam[];
  /** Always says whose rule it is (CLAUDE.md, «ИИ-ассистент»). */
  sourceNote: string;
  ruleId: Id | null;
};

const TEAM_NOTE = 'Правило справочника.';
const ORGANIZER_NOTE =
  'Источник порога — материалы организаторов.';

/** How a rule kind measures its number. A new kind is a contract change anyway. */
const RULE_METHODS: Readonly<Record<string, string>> = {
  count:
    'Число — сколько объектов этого типа отнесено к зоне (связь объект → зона). Считает инвентаризация; ассистент видит то же число.',
  'distance-to-entrance':
    'Расстояние — по прямой от центра объекта до середины проёма входа. Берётся ближайший вход, если вход в правиле не задан.',
};

/** Parameter names of a catalog rule; an unknown one is shown by its key. */
const PARAM_LABELS: Readonly<Record<string, string>> = {
  objectTypeId: 'Тип объекта',
  zoneTypeId: 'Тип зоны',
  scope: 'Что считаем',
  min: 'Минимум',
  max: 'Максимум',
  maxDistance_m: 'Не дальше',
  entranceId: 'Вход',
};

const RULE_META_KEYS = new Set(['id', 'source', 'rationale', 'kind']);

/**
 * Structural checks of `domain/validation` that have no description record in
 * domain (unlike `PHYSICS_RULES`). Gap: these belong next to the checks.
 */
const CHECK_METHODS: Readonly<Record<string, { title: string; method: string }>> = {
  [VALIDATION_ISSUE_CODES.OBJECT_OUTSIDE_ZONE]: {
    title: 'Объект лежит в своей зоне целиком',
    method: 'Контур объекта сравнивается с контуром зоны, к которой он отнесён: ни одна вершина не выходит наружу.',
  },
  [VALIDATION_ISSUE_CODES.ZONE_OUTSIDE_ROOM]: {
    title: 'Зона внутри помещения',
    method: 'Контур зоны сравнивается с контуром помещения: ни одна вершина не выходит наружу.',
  },
  [VALIDATION_ISSUE_CODES.ZONE_OUTSIDE_PARENT]: {
    title: 'Вложенная зона внутри родительской',
    method: 'Контур вложенной зоны сравнивается с контуром родительской зоны.',
  },
  [VALIDATION_ISSUE_CODES.ZONE_OVERLAPS_ZONE]: {
    title: 'Зоны делят пол только вложением',
    method: 'Две зоны с общей площадью допустимы, только если одна целиком лежит в другой.',
  },
  [VALIDATION_ISSUE_CODES.POLYGON_UNUSABLE]: {
    title: 'Контур не пересекает сам себя',
    method: 'Стороны контура не пересекаются. Иначе площадь и вложенность не считаются.',
  },
  [VALIDATION_ISSUE_CODES.OBJECT_DUPLICATE_INVENTORY_NUMBER]: {
    title: 'У каждого предмета свой инвентарный номер',
    method: 'Непустые инвентарные номера сравниваются по всему плану. Повтор относится к первому владельцу номера.',
  },
  [VALIDATION_ISSUE_CODES.OBJECT_MISSING_INVENTORY_NUMBER]: {
    title: 'Инвентарный номер заполнен',
    method: 'Тип объекта объявляет инвентарный номер, а у объекта он пуст. Проверка молчит, если номеров в плане нет совсем.',
  },
  [RELATION_ISSUE_CODES.ZONE_UNASSIGNED]: {
    title: 'Объект стоит в какой-либо зоне',
    method: 'Ни одна зона не содержит контур объекта целиком.',
  },
  [RELATION_ISSUE_CODES.ZONE_GEOMETRY_UNUSABLE]: {
    title: 'Контур зоны пригоден для расчёта',
    method: 'По контуру зоны нельзя определить, что в ней лежит.',
  },
};

function typeLabel(plan: PlanDocument, id: Id): string {
  return findObjectType(plan.catalog, id)?.label ?? id;
}

function zoneLabel(plan: PlanDocument, id: Id): string {
  return findZoneType(plan.catalog, id)?.label ?? id;
}

/** Readable title of a catalog rule from its data; the rule id is never shown. */
function ruleTitle(plan: PlanDocument, rule: Rule): string {
  if (rule.kind === 'distance-to-entrance') {
    return `${typeLabel(plan, rule.objectTypeId)} — не дальше ${formatShort(rule.maxDistance_m, 2)} м от входа`;
  }
  if (rule.kind === 'count') {
    const where = `${typeLabel(plan, rule.objectTypeId)}, зона «${zoneLabel(plan, rule.zoneTypeId)}»`;
    if (rule.min !== null && rule.max !== null) return `${where}: от ${rule.min} до ${rule.max}`;
    if (rule.min !== null) return `${where}: не меньше ${rule.min}`;
    if (rule.max !== null) return `${where}: не больше ${rule.max}`;
  }
  return 'Правило справочника';
}

function paramValue(plan: PlanDocument, key: string, value: unknown): string | null {
  if (value === null || value === undefined) {
    if (key === 'entranceId') return 'ближайший вход';
    return null;
  }
  if (key === 'objectTypeId' && typeof value === 'string') return `«${typeLabel(plan, value)}»`;
  if (key === 'zoneTypeId' && typeof value === 'string') {
    return `«${zoneLabel(plan, value)}»`;
  }
  if (key === 'scope') return value === 'direct' ? 'только сама зона' : 'зона вместе с вложенными';
  if (key.endsWith('_m') && typeof value === 'number') return `${formatShort(value, 2)} м`;
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function ruleParams(plan: PlanDocument, rule: Rule): WhyParam[] {
  const params: WhyParam[] = [];
  for (const [key, value] of Object.entries(rule)) {
    if (RULE_META_KEYS.has(key)) continue;
    const shown = paramValue(plan, key, value);
    if (shown === null) continue;
    params.push({ label: PARAM_LABELS[key] ?? key, value: shown });
  }
  return params;
}

/** The explanation for one finding. Every finding gets one. */
export function explainFinding(plan: PlanDocument, issue: ValidationIssue): FindingWhy {
  const rule = (issue.ruleIds ?? [])
    .map((id) => plan.catalog.rules.find((entry) => entry.id === id))
    .find((entry) => entry !== undefined);
  if (rule !== undefined) {
    return {
      title: ruleTitle(plan, rule),
      method: RULE_METHODS[rule.kind] ?? 'Как получено число — в тексте находки.',
      rationale: rule.rationale,
      params: ruleParams(plan, rule),
      sourceNote: rule.source === 'organizer-material' ? ORGANIZER_NOTE : TEAM_NOTE,
      ruleId: rule.id,
    };
  }

  const physics = PHYSICS_RULES.find((entry) => entry.code === issue.code);
  if (physics !== undefined) {
    return {
      title: physics.title,
      method: physics.detail,
      rationale: null,
      params: [],
      sourceNote: `Правило физики плана. ${TEAM_NOTE}`,
      ruleId: physics.id,
    };
  }

  const check = CHECK_METHODS[issue.code];
  return {
    title: check?.title ?? 'Проверка плана',
    method: check?.method ?? 'У этой проверки нет описания в справочнике правил. Что найдено — в тексте находки.',
    rationale: null,
    params: [],
    sourceNote: `Проверка геометрии плана. ${TEAM_NOTE}`,
    ruleId: null,
  };
}

/** What the fix variant does with the plan. */
export type FixPlan =
  | { kind: 'add'; typeId: Id; zoneId: Id }
  | { kind: 'move'; object: Equipment; zoneId: Id | null; anchor: Point; toEntrance: boolean }
  /** Over the maximum of a stocking rule: one object goes. */
  | { kind: 'remove'; object: Equipment; retired: boolean }
  | { kind: 'none'; reason: string };

/** Findings a new place for the object fixes. */
const MOVE_CODES: ReadonlySet<string> = new Set([
  VALIDATION_ISSUE_CODES.OBJECT_COLLISION,
  VALIDATION_ISSUE_CODES.OBJECT_HITS_WALL,
  VALIDATION_ISSUE_CODES.OBJECT_OUTSIDE_ROOM,
  VALIDATION_ISSUE_CODES.OBJECT_OUTSIDE_ZONE,
  VALIDATION_ISSUE_CODES.OBJECT_BLOCKS_OPENING,
]);

function mentionCount(issues: readonly Issue[], id: Id): number {
  return issues.filter((entry) => entry.refs.some((ref) => ref.kind === 'object' && ref.id === id)).length;
}

/**
 * Which fix the assistant can search for. Of two colliding objects the one
 * with more findings moves: in the example it is the rack in the partition,
 * not the cashier window it hits.
 */
export function planFix(plan: PlanDocument, issue: ValidationIssue, issues: readonly Issue[]): FixPlan {
  const rule = (issue.ruleIds ?? [])
    .map((id) => plan.catalog.rules.find((entry) => entry.id === id))
    .find((entry) => entry !== undefined);
  const objects = issue.refs
    .filter((ref) => ref.kind === 'object')
    .map((ref) => plan.objects.find((object) => object.id === ref.id))
    .filter((object): object is Equipment => object !== undefined);

  if (rule?.kind === 'count' && issue.code === VALIDATION_ISSUE_CODES.RULE_COUNT_BELOW_MIN) {
    const zone = issue.refs.find((ref) => ref.kind === 'zone');
    if (zone !== undefined) return { kind: 'add', typeId: rule.objectTypeId, zoneId: zone.id };
  }

  // Of the objects the rule counts, the one marked «выведено из эксплуатации»
  // goes first; without one, the last in the list.
  if (rule?.kind === 'count' && issue.code === VALIDATION_ISSUE_CODES.RULE_COUNT_ABOVE_MAX) {
    const zone = issue.refs.find((ref) => ref.kind === 'zone');
    const counted = zone === undefined ? [] : objectsInZoneScope(plan, rule.objectTypeId, zone.id, rule.scope);
    const retired = counted.find((object) => object.attributes.equipmentStatus === 'retired');
    const doomed = retired ?? counted.at(-1);
    if (doomed !== undefined) return { kind: 'remove', object: doomed, retired: retired !== undefined };
  }

  if (rule?.kind === 'distance-to-entrance' && objects[0] !== undefined) {
    const openingRef = issue.refs.find((ref) => ref.kind === 'opening');
    const opening = plan.openings.find((entry) => entry.id === openingRef?.id);
    const wall = plan.walls.find((entry) => entry.id === opening?.wallId);
    if (opening !== undefined && wall !== undefined) {
      return { kind: 'move', object: objects[0], zoneId: null, anchor: openingCentre(opening, wall), toEntrance: true };
    }
  }

  if (MOVE_CODES.has(issue.code) && objects.length > 0) {
    const mover = objects.reduce((best, object) =>
      mentionCount(issues, object.id) > mentionCount(issues, best.id) ? object : best,
    );
    return { kind: 'move', object: mover, zoneId: mover.zoneId, anchor: mover.position, toEntrance: false };
  }

  return { kind: 'none', reason: 'Для этой находки ассистент вариант не ищет: исправьте план вручную.' };
}

export type FixResult =
  | { ok: true; candidate: Candidate; fix: Extract<FixPlan, { kind: 'add' | 'move' }> }
  /** A removal has no ghost: nothing new stands on the plan. */
  | { ok: true; candidate: null; fix: Extract<FixPlan, { kind: 'remove' }> }
  | { ok: false; message: string };

/**
 * The best spot from the assistant's placement search. A moved object is
 * searched for in the plan without it, so its own old footprint does not
 * block the new one, and the old findings do not count as "already there".
 */
export function findFix(plan: PlanDocument, fix: Exclude<FixPlan, { kind: 'none' }>): FixResult {
  if (fix.kind === 'remove') return { ok: true, candidate: null, fix };
  const found =
    fix.kind === 'add'
      ? findPlacements(plan, { scenario: 'place', typeId: fix.typeId, zoneId: fix.zoneId })
      : findPlacements(
          { ...plan, objects: plan.objects.filter((object) => object.id !== fix.object.id) },
          { scenario: 'place', typeId: fix.object.typeId, zoneId: fix.zoneId, anchor: fix.anchor },
        );
  if (!found.ok) return { ok: false, message: found.issues.map((entry) => entry.message).join('; ') };
  const candidate = found.value[0];
  if (candidate === undefined) {
    return { ok: false, message: 'Свободного места не нашлось на сетке поиска ассистента.' };
  }
  return { ok: true, candidate, fix };
}
