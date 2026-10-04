/**
 * V02 (подсветка): какие находки проверки показать на холсте.
 *
 * Список находок называет объекты словами; холст должен показать место. Каждая
 * находка уже несёт `polygon` — отпечаток объекта, контур зоны, — и когда
 * пользователь кликает по ссылке в списке, на плане подсвечиваются все
 * находки, которые ссылаются на тот же объект: у стеллажа примера это сразу и
 * коллизия с кассой, и пересечение перегородки, и выход из зоны.
 *
 * Чистая функция без React и Konva: что подсветить — решается здесь;
 * слой лишь рисует.
 */

import type { Issue, Point, Polygon, Ref, Severity, Viewport } from '../../contracts/model';
import { modelToScreen } from '../../domain/geometry';
import type { IssueMeasure, ValidationIssue } from '../../domain/validation';

export type IssueHighlight = {
  code: string;
  severity: Severity;
  polygon: Polygon;
};

function sameRef(a: Ref, b: Ref): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/**
 * Находки о сфокусированной сущности, у которых есть что показать. Порядок —
 * порядок списка: ошибки рисуются поверх предупреждений, потому что список
 * уже отсортировал их первыми.
 *
 * Заливкой подсвечивается только сфокусированное: если залить все находки
 * сразу, план с примером организаторов превращается в красное пятно. Что
 * находки вообще есть, показывают маркеры `issueMarkers` — они видны всегда.
 */
export function highlightsFor(issues: Issue[], focus: Ref | null): IssueHighlight[] {
  if (focus === null) return [];
  const out: IssueHighlight[] = [];
  for (const issue of issues) {
    if (issue.polygon === undefined || issue.polygon.length < 3) continue;
    if (!issue.refs.some((ref) => sameRef(ref, focus))) continue;
    out.push({ code: issue.code, severity: issue.severity, polygon: issue.polygon });
  }
  return out;
}

/** Цвета подсветки: те же, что у полосок в списке находок. */
export const HIGHLIGHT_COLORS: Readonly<Record<Severity, string>> = {
  error: '#C92A2A',
  warning: '#E8590C',
};

/** Значок на плане: одна затронутая сущность и сколько находок о ней. */
export type IssueMarker = {
  ref: Ref;
  count: number;
  /** Самая серьёзная из её находок: одна ошибка красит значок в красный. */
  severity: Severity;
  /** Где стоит значок: полигон первой находки о сущности. */
  polygon: Polygon;
  focused: boolean;
};

/**
 * Маркеры находок, видимые без клика (D-157). Находка помечает свою первую
 * ссылку: её `polygon` — отпечаток именно этой сущности (объекта в коллизии,
 * стеллажа у стены, зоны в правиле комплектования). Находка без полигона
 * показать место не может и живёт только в списке.
 */
export function issueMarkers(issues: Issue[], focus: Ref | null): IssueMarker[] {
  const byKey = new Map<string, IssueMarker>();
  for (const issue of issues) {
    const ref = issue.refs[0];
    if (ref === undefined) continue;
    if (issue.polygon === undefined || issue.polygon.length < 3) continue;
    const key = `${ref.kind}:${ref.id}`;
    const known = byKey.get(key);
    if (known === undefined) {
      byKey.set(key, {
        ref,
        count: 1,
        severity: issue.severity,
        polygon: issue.polygon,
        focused: focus !== null && sameRef(ref, focus),
      });
      continue;
    }
    known.count += 1;
    if (issue.severity === 'error') known.severity = 'error';
  }
  return [...byKey.values()];
}

/** Отрезок, который измерило правило расстояния, и цвет его находки. */
export type IssueMeasureLine = IssueMeasure & { severity: Severity };

/**
 * Пунктир «объект → вход» у находок правила расстояния (#14). Показывается,
 * когда находка выбрана: выделен её объект или её вход. Иначе на плане с
 * несколькими терминалами линии перекрыли бы всё.
 */
export function measuresFor(issues: ValidationIssue[], focus: Ref | null): IssueMeasureLine[] {
  if (focus === null) return [];
  const out: IssueMeasureLine[] = [];
  for (const issue of issues) {
    if (issue.measure === undefined) continue;
    if (!issue.refs.some((ref) => sameRef(ref, focus))) continue;
    out.push({ ...issue.measure, severity: issue.severity });
  }
  return out;
}

/** Находки об одной сущности: в списке они идут одним пунктом. */
export type IssueGroup<T extends Issue> = {
  /** Первая ссылка находок группы; null — находка без ссылок, она одна. */
  ref: Ref | null;
  severity: Severity;
  issues: T[];
};

/**
 * Сводит находки одной сущности в одну группу (#14). Ключ — первая ссылка
 * находки, как у маркера на плане: число в значке равно числу строк в группе.
 * Порядок — порядок первой находки группы, внутри группы — исходный.
 */
export function groupIssuesBySubject<T extends Issue>(issues: T[]): IssueGroup<T>[] {
  const groups: IssueGroup<T>[] = [];
  const byKey = new Map<string, IssueGroup<T>>();
  for (const issue of issues) {
    const ref = issue.refs[0];
    if (ref === undefined) {
      groups.push({ ref: null, severity: issue.severity, issues: [issue] });
      continue;
    }
    const key = `${ref.kind}:${ref.id}`;
    const known = byKey.get(key);
    if (known === undefined) {
      const group: IssueGroup<T> = { ref, severity: issue.severity, issues: [issue] };
      byKey.set(key, group);
      groups.push(group);
      continue;
    }
    known.issues.push(issue);
    if (issue.severity === 'error') known.severity = 'error';
  }
  return groups;
}

/** Правый верхний угол фигуры на экране — там значок не закрывает саму фигуру. */
export function markerAnchor(polygon: Polygon, viewport: Viewport): Point {
  const screen = polygon.map((point) => modelToScreen(point, viewport));
  return [
    Math.max(...screen.map((point) => point[0])),
    Math.min(...screen.map((point) => point[1])),
  ];
}
