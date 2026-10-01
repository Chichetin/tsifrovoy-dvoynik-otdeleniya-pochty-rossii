/**
 * D-286: набор правил физики плана — что помещение и его оборудование не
 * могут держать физически, в отличие от правил комплектования, которые
 * говорят лишь, чего не хватает.
 *
 * Правил четыре, и все они уже считаются проверкой плана
 * (`domain/validation`) — здесь выделено их подмножество и добавлены два
 * применения, которых у проверки нет:
 *
 * 1. `objectPhysicsIssues` — те же правила, но об одном объекте против всего
 *    остального плана. Этого хватает жесту: при перестановке стула проверять
 *    полмиллиона чужих пар незачем.
 * 2. `physicsRejection` — решение «так править нельзя»: объект после команды
 *    нарушает физику так, как до команды не нарушал. Уже стоящий в стене
 *    стеллаж (`example_plan.json` приносит три таких) этим не запирается —
 *    его можно двигать и дальше, нельзя только создать новое нарушение.
 *
 * Коды и сообщения общие с проверкой плана: одно нарушение называется в
 * панели проверки и в отказе жеста одними словами, а не двумя похожими.
 *
 * Это правила команды, а не норматив Почты.
 */

import type { Catalog, Equipment, Id, Issue, PlanDocument, Polygon } from '../../contracts/model';
import { TOLERANCE } from '../../contracts/model';
import { outerWallIds } from '../commands/room-walls';
import {
  boundingBox,
  boxesOverlap,
  contains,
  footprint,
  intersects,
  intervalsOverlap,
  objectHitsWall,
  objectInterval,
} from '../geometry';
import { formatLength } from '../number-format';
import { VALIDATION_ISSUE_CODES, isPhysical, validatePlan } from '../validation';

export type PhysicsRule = {
  id: Id;
  /** Код находки, которым правило говорит о нарушении. */
  code: string;
  title: string;
  detail: string;
};

/**
 * Список для человека: накладка «Правила физики» читает его, а не свою копию
 * разметки. Новое правило добавляется строкой здесь и проверкой с тем же кодом.
 */
export const PHYSICS_RULES: readonly PhysicsRule[] = [
  {
    id: 'phys_collision',
    code: VALIDATION_ISSUE_CODES.OBJECT_COLLISION,
    title: 'Объекты не проникают друг в друга',
    detail:
      'Объёмы сравниваются вместе с высотами: стул на столе — нарушение, камера под потолком над столом — нет.',
  },
  {
    id: 'phys_ceiling',
    code: VALIDATION_ISSUE_CODES.OBJECT_ABOVE_CEILING,
    title: 'Ничто не торчит сквозь потолок',
    detail: 'Верх объекта — это его «низ» плюс высота; он не превышает высоту помещения.',
  },
  {
    id: 'phys_room',
    code: VALIDATION_ISSUE_CODES.OBJECT_OUTSIDE_ROOM,
    title: 'Объект целиком внутри помещения',
    detail: 'Контур объекта остаётся внутри контура помещения — ни одной вершиной наружу.',
  },
  {
    id: 'phys_wall',
    code: VALIDATION_ISSUE_CODES.OBJECT_HITS_WALL,
    title: 'Оборудование не проходит сквозь стены',
    detail: 'Сквозь стену и перегородку объект идёт только там, где на его высоте есть проём.',
  },
];

/** Коды, которыми говорят правила физики. */
export const PHYSICS_ISSUE_CODES: ReadonlySet<string> = new Set(
  PHYSICS_RULES.map((rule) => rule.code),
);

/** Нарушения физики среди любых находок проверки плана. */
export function physicsIssues(issues: readonly Issue[]): Issue[] {
  return issues.filter((entry) => PHYSICS_ISSUE_CODES.has(entry.code));
}

/**
 * Нарушения физики всего плана — та же проверка, что показывает вкладка
 * «Проверка», просто без правил комплектования. Этим пользуется отказ
 * сохранения: окно и панель не могут разойтись, потому что считает одно и то
 * же. Отдельная функция ещё и потому, что граница импортов не даёт feature
 * читать `domain/validation` напрямую — имя совпадает с именем feature.
 */
export function planPhysicsIssues(plan: PlanDocument): Issue[] {
  return physicsIssues(validatePlan(plan));
}

function issueOf(code: string, message: string, refs: Issue['refs'], polygon: Polygon): Issue {
  return { code, severity: 'error', message, refs, polygon };
}

function solid(catalog: Catalog, object: Equipment): boolean {
  return isPhysical(catalog, object);
}

/**
 * Нарушения физики одного объекта против всего плана. Порядок — как в
 * `PHYSICS_RULES`; сообщения совпадают с `validatePlan`, потому что одно и то
 * же нарушение показывается в двух местах.
 */
export function objectPhysicsIssues(plan: PlanDocument, object: Equipment): Issue[] {
  const shape = footprint(object);
  const issues: Issue[] = [];
  const physical = solid(plan.catalog, object);

  if (physical) {
    const box = boundingBox(shape);
    const interval = objectInterval(object);
    for (const other of plan.objects) {
      if (other.id === object.id) continue;
      if (!solid(plan.catalog, other)) continue;
      const otherShape = footprint(other);
      if (!boxesOverlap(box, boundingBox(otherShape))) continue;
      if (!intervalsOverlap(interval, objectInterval(other))) continue;
      if (!intersects(shape, otherShape)) continue;
      issues.push(
        issueOf(
          VALIDATION_ISSUE_CODES.OBJECT_COLLISION,
          `Объекты «${object.label}» и «${other.label}» занимают одно место.`,
          [
            { kind: 'object', id: object.id },
            { kind: 'object', id: other.id },
          ],
          shape,
        ),
      );
    }
  }

  const top = object.base_m + object.height_m;
  if (top > plan.room.ceilingHeight_m + TOLERANCE.coordinate_m) {
    issues.push(
      issueOf(
        VALIDATION_ISSUE_CODES.OBJECT_ABOVE_CEILING,
        `Объект «${object.label}» поднимается до ${formatLength(top)} — выше потолка ${formatLength(plan.room.ceilingHeight_m)}.`,
        [
          { kind: 'object', id: object.id },
          { kind: 'room', id: plan.room.id },
        ],
        shape,
      ),
    );
  }

  if (!contains(plan.room.boundary, shape)) {
    issues.push(
      issueOf(
        VALIDATION_ISSUE_CODES.OBJECT_OUTSIDE_ROOM,
        `Объект «${object.label}» выходит за границы помещения.`,
        [
          { kind: 'object', id: object.id },
          { kind: 'room', id: plan.room.id },
        ],
        shape,
      ),
    );
  }

  if (physical) {
    const outer = outerWallIds(plan.walls, plan.room.boundary);
    for (const wall of plan.walls) {
      if (!objectHitsWall(object, wall, plan.openings, plan.walls)) continue;
      issues.push(
        issueOf(
          VALIDATION_ISSUE_CODES.OBJECT_HITS_WALL,
          `Объект «${object.label}» пересекает ${outer.has(wall.id) ? 'наружную стену' : 'перегородку'}.`,
          [
            { kind: 'object', id: object.id },
            { kind: 'wall', id: wall.id },
          ],
          shape,
        ),
      );
    }
  }

  return issues;
}

/**
 * Чем жест ограничен на месте, а чем — только при сохранении (D-286).
 *
 * Жест останавливают два правила из четырёх: чужой объём и потолок. Это
 * ровно те два случая, ради которых граница и заводилась («стул на столе»,
 * «вывеска выше потолка»), и они ни с чем не спорят.
 *
 * Стены и границу помещения жест не сторожит намеренно. Настенное
 * оборудование стоит вплотную к стене (`features/equipment/wall-mount.ts`):
 * поворот такой камеры любым углом, кроме прямого, вводит её угол в стену, и
 * сторожащий жест не дал бы её навести. Эти два правила остаются ошибкой в
 * панели проверки и по-прежнему останавливают сохранение файла — то есть
 * план с ними из редактора не выйдет молча, но целиться камерой не мешают.
 */
const GESTURE_GATED: ReadonlySet<string> = new Set([
  VALIDATION_ISSUE_CODES.OBJECT_COLLISION,
  VALIDATION_ISSUE_CODES.OBJECT_ABOVE_CEILING,
]);

/** Нарушение узнаётся по правилу и участникам, а не по тексту сообщения. */
function signature(entry: Issue): string {
  return `${entry.code}|${entry.refs.map((ref) => `${ref.kind}:${ref.id}`).join(',')}`;
}

function objectsById(plan: PlanDocument): Map<Id, Equipment> {
  return new Map(plan.objects.map((object) => [object.id, object]));
}

/**
 * Отказ команде: объект после неё нарушает физику так, как до неё не нарушал.
 *
 * Сравнение идёт по самому нарушению, а не по их числу: стеллаж, уже стоящий
 * в стене, остаётся передвигаемым (то же нарушение было и до жеста), но
 * задвинуть его ещё и в стол нельзя. Загрузка файла командами не идёт,
 * поэтому `example_plan.json` со своими нарушениями открывается как прежде.
 */
export function physicsRejection(
  before: PlanDocument,
  after: PlanDocument,
  touched: readonly Id[],
): Issue | null {
  if (touched.length === 0) return null;
  const was = objectsById(before);
  const now = objectsById(after);
  for (const id of touched) {
    const object = now.get(id);
    if (object === undefined) continue;
    const fresh = objectPhysicsIssues(after, object).filter((entry) => GESTURE_GATED.has(entry.code));
    if (fresh.length === 0) continue;
    const previous = was.get(id);
    const known =
      previous === undefined
        ? new Set<string>()
        : new Set(objectPhysicsIssues(before, previous).map(signature));
    const created = fresh.find((entry) => !known.has(signature(entry)));
    if (created !== undefined) return created;
  }
  return null;
}
