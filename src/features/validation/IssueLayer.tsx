/**
 * V02 (подсветка): полигоны находок проверки поверх плана.
 *
 * Слой ничего не решает и ничего не ловит мышью: список находок выбрал, о чём
 * речь, `highlightsFor` отобрал полигоны, здесь они только рисуются. Слой
 * стоит выше фигур плана, поэтому `listening={false}` обязателен — иначе он
 * заслонил бы объект, который пользователь хочет потянуть после исправления.
 */

import { Layer, Line } from 'react-konva';
import type { Issue, Ref, Viewport } from '../../contracts/model';
import { modelToScreen } from '../../domain/geometry';
import { HIGHLIGHT_COLORS, highlightsFor } from './issue-highlight';

export type IssueLayerProps = {
  issues: Issue[];
  /** Выделенная сущность — из списка или кликом на холсте; null гасит подсветку. */
  focus: Ref | null;
  viewport: Viewport;
};

export function IssueLayer({ issues, focus, viewport }: IssueLayerProps): React.JSX.Element {
  const highlights = highlightsFor(issues, focus);
  return (
    <Layer listening={false} name="issue-highlights">
      {highlights.map((entry, index) => (
        <Line
          key={`${entry.code}-${index}`}
          points={entry.polygon.flatMap((point) => modelToScreen(point, viewport))}
          closed
          fill={HIGHLIGHT_COLORS[entry.severity]}
          opacity={0.22}
          stroke={HIGHLIGHT_COLORS[entry.severity]}
          strokeWidth={2.5}
          dash={[8, 4]}
        />
      ))}
    </Layer>
  );
}
