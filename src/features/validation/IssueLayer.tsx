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
 * Подсветка и остальной слой мышь по-прежнему не ловят — иначе слой заслонил
 * бы объект, который пользователь хочет потянуть после исправления. Ловит
 * только сам кружочек маркера (V02-marker-click): клик по нему открывает
 * находки сущности в списке, но не должен провалиться в объект под ним, —
 * `cancelBubble` останавливает всплытие раньше, чем его увидят инструмент
 * плана и рамка выделения на слое оборудования. Слой становится `listening`
 * только когда `onMarkerClick` передан (в режимах «Выбор»/«Обзор»): во время
 * рисования её не задают, и клик по маркеру проходит насквозь, как раньше.
 *
 * Маркер — узел Konva с `name="issue-marker"`, `id` вида
 * `issue-marker:<kind>:<id>` и атрибутами `issueCount`, `severity`,
 * `focused`: DOM-атрибутов у фигур холста нет, e2e читает их через Konva.
 */

import type Konva from 'konva';
import { Circle, Group, Layer, Line, Text } from 'react-konva';
import type { Issue, Ref, Viewport } from '../../contracts/model';
import { modelToScreen } from '../../domain/geometry';
import { HIGHLIGHT_COLORS, highlightsFor, issueMarkers, markerAnchor } from './issue-highlight';

export type IssueLayerProps = {
  issues: Issue[];
  /** Выделенная сущность — из списка или кликом на холсте; null гасит подсветку. */
  focus: Ref | null;
  viewport: Viewport;
  /**
   * Клик по кружочку маркера. Не задан — маркеры не ловят мышь вовсе (во
   * время рисования инструмент получает клик как раньше).
   */
  onMarkerClick?: (ref: Ref) => void;
};

function setCursor(event: Konva.KonvaEventObject<MouseEvent>, cursor: string): void {
  const container = event.target.getStage()?.container();
  if (container !== undefined) container.style.cursor = cursor;
}

/** Кайма вокруг контура и значка: светлая на тёмном и красном, заметная на светлом полу. */
const HALO = '#FFFFFF';
const FOCUS_RING = '#212529';
const MARKER_RADIUS = 9;
/** Same value as HANDLE_RADIUS_PX in features/equipment: keep equal. */
const RESIZE_HANDLE_RADIUS_PX = 6;
const FOCUSED_MARKER_RADIUS = 13;

export function IssueLayer({ issues, focus, viewport, onMarkerClick }: IssueLayerProps): React.JSX.Element {
  const highlights = highlightsFor(issues, focus);
  const markers = issueMarkers(issues, focus);
  const clickable = onMarkerClick !== undefined;
  return (
    <Layer listening={clickable} name="issue-highlights">
      <Group name="issue-focus" listening={false}>
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
          // Clear of the corner by the marker's own radius plus the handle's:
          // this layer sits above the equipment layer, so a marker centred
          // near the corner would hide the resize handle of a selected object.
          const shift = radius + RESIZE_HANDLE_RADIUS_PX;
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
              listening={clickable}
              onPointerDown={
                onMarkerClick === undefined
                  ? undefined
                  : (event) => {
                      // The stage must not read this press as a tool click:
                      // without it the select tool would start a marquee, or
                      // the object right under the marker would take the
                      // click and begin a drag.
                      event.cancelBubble = true;
                      onMarkerClick(marker.ref);
                    }
              }
              onMouseEnter={onMarkerClick === undefined ? undefined : (event) => setCursor(event, 'pointer')}
              onMouseLeave={onMarkerClick === undefined ? undefined : (event) => setCursor(event, 'default')}
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
