/**
 * V02 (подсветка): какие находки проверки показать на холсте.
 *
 * Список находок называет объекты словами; холст должен показать место. Каждая
 * находка уже несёт `polygon` — отпечаток объекта, контур зоны, — и когда
 * пользователь кликает по ссылке в списке, на плане подсвечиваются все
 * находки, которые ссылаются на тот же объект: у стеллажа примера это сразу и
 * коллизия с кассой, и пересечение перегородки, и выход из зоны.
 *
 * Чистая функция без React и Konva: что подсветить — решается здесь и
 * проверяется тестом; слой лишь рисует.
 */

import type { Issue, Polygon, Ref, Severity } from '../../contracts/model';

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
 * Полигоны без сфокусированного объекта не подсвечиваются намеренно: если
 * рисовать все находки сразу, план с примером организаторов превращается в
 * красное пятно, и не видно, куда именно кликнул пользователь.
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
