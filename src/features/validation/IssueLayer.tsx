/**
 * V02 (подсветка): находки проверки поверх плана.
 *
 * Один слой Konva, две группы. Подсветка выделенной сущности — заливка и
 * сплошной контур с белой каймой, который читается и на красном объекте, где
 * пунктир того же цвета терялся. Поверх неё маркеры: у каждой затронутой
 * сущности значок с числом находок и цветом по серьёзности, виден всегда, без
 * клика (D-157). Отдельный слой под маркеры не заводится: у сцены их и так
 * шесть при рекомендованных Konva 3–5.
 *
 * Слой ничего не решает и ничего не ловит мышью: что рисовать, решает
 * `issue-highlight.ts`. Слой стоит выше фигур плана, поэтому
 * `listening={false}` обязателен — иначе он заслонил бы объект, который
 * пользователь хочет потянуть после исправления.
 *
 * Маркер — узел Konva с `name="issue-marker"`, `id` вида
 * `issue-marker:<kind>:<id>` и атрибутами `issueCount`, `severity`,
 * `focused`: DOM-атрибутов у фигур холста нет, e2e читает их через Konva.
 */

import { Circle, Group, Layer, Line, Text } from 'react-konva';
import type { Issue, Ref, Viewport } from '../../contracts/model';
import { modelToScreen } from '../../domain/geometry';
import { HIGHLIGHT_COLORS, highlightsFor, issueMarkers, markerAnchor } from './issue-highlight';

export type IssueLayerProps = {
  issues: Issue[];
  /** Выделенная сущность — из списка или кликом на холсте; null гасит подсветку. */
  focus: Ref | null;
  viewport: Viewport;
};

/** Кайма вокруг контура и значка: светлая на тёмном и красном, заметная на светлом полу. */
const HALO = '#FFFFFF';
const FOCUS_RING = '#212529';
const MARKER_RADIUS = 9;
const FOCUSED_MARKER_RADIUS = 13;

export function IssueLayer({ issues, focus, viewport }: IssueLayerProps): React.JSX.Element {
  const highlights = highlightsFor(issues, focus);
  const markers = issueMarkers(issues, focus);
  return (
    <Layer listening={false} name="issue-highlights">
      <Group name="issue-focus">
        {highlights.map((entry, index) => {
          const points = entry.polygon.flatMap((point) => modelToScreen(point, viewport));
          const color = HIGHLIGHT_COLORS[entry.severity];
          return (
            <Group key={`${entry.code}-${index}`} name="issue-focus-shape">
              <Line points={points} closed fill={color} opacity={0.22} />
              <Line points={points} closed stroke={HALO} strokeWidth={6} />
              <Line points={points} closed stroke={color} strokeWidth={3} />
            </Group>
          );
        })}
      </Group>
      <Group name="issue-markers">
        {markers.map((marker) => {
          const [x, y] = markerAnchor(marker.polygon, viewport);
          const radius = marker.focused ? FOCUSED_MARKER_RADIUS : MARKER_RADIUS;
          // Half a radius out of the corner: the resize handle of a selected
          // object sits exactly on the corner and would cover the number.
          const shift = radius * 0.5;
          return (
            <Group
              key={`${marker.ref.kind}:${marker.ref.id}`}
              name="issue-marker"
              id={`issue-marker:${marker.ref.kind}:${marker.ref.id}`}
              issueCount={marker.count}
              severity={marker.severity}
              focused={marker.focused}
              x={x + shift}
              y={y - shift}
            >
              <Circle
                radius={radius}
                fill={HIGHLIGHT_COLORS[marker.severity]}
                stroke={marker.focused ? FOCUS_RING : HALO}
                strokeWidth={marker.focused ? 3 : 2}
              />
              <Text
                text={String(marker.count)}
                x={-radius}
                y={-radius}
                width={radius * 2}
                height={radius * 2}
                align="center"
                verticalAlign="middle"
                fontSize={marker.focused ? 14 : 11}
                fontStyle="bold"
                fill={HALO}
              />
            </Group>
          );
        })}
      </Group>
    </Layer>
  );
}
