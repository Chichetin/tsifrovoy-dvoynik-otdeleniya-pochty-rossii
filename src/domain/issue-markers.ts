/**
 * Finding markers on the plan (D-157), shared by the canvas and the PNG/SVG
 * export (#220): which entity gets a marker, how many findings it counts and
 * which colour it takes.
 */

import type { Issue, Polygon, Ref, Severity } from '../contracts/model';

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

function sameRef(a: Ref, b: Ref): boolean {
  return a.kind === b.kind && a.id === b.id;
}

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
