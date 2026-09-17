/**
 * U05 (представление): информационные слои поверх плана.
 *
 * Слой ничего не содержит и ничего не меняет: он читает атрибуты зон и
 * объектов и рисует их. Что именно рисовать, решает справочник — тип слоя
 * приносит вид представления, атрибут и цвета, поэтому новый слой «очередь»
 * появился рядом с «нагрузкой» одной записью JSON.
 *
 * Числа в этих слоях синтетические: их вводит человек в панели слоёв. Подпись
 * об этом выводится прямо на холст, а не только в панели, — иначе снимок
 * экрана в презентации выглядит как измеренные данные.
 */

import { Circle, Layer, Line, Text } from 'react-konva';
import type { Equipment, Id, LayerType, Point, Polygon, Zone } from '../../contracts/model';
import type { InformationLayerProps } from '../../contracts/ui';
import { findLayerType } from '../../domain/catalog';
import { modelToScreen, viewSector } from '../../domain/geometry';

const CAPTION_FILL = '#495057';
const BADGE_TEXT = '#FFFFFF';

/** Середина габаритов полигона: достаточно, чтобы повесить на зону подпись. */
function labelAnchor(polygon: Polygon): Point {
  const xs = polygon.map((point) => point[0]);
  const ys = polygon.map((point) => point[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

function numberAttribute(
  attributes: Record<string, string | number | boolean | null>,
  key: string,
): number | null {
  const value = attributes[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Линейная смесь двух цветов #RRGGBB: 0 — первый, 1 — второй. */
function mixColors(from: string, to: string, ratio: number): string {
  const channel = (hex: string, at: number): number => parseInt(hex.slice(at, at + 2), 16);
  const blend = (at: number): string => {
    const value = Math.round(channel(from, at) + (channel(to, at) - channel(from, at)) * ratio);
    return Math.min(Math.max(value, 0), 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${blend(1)}${blend(3)}${blend(5)}`;
}

function formatValue(value: number, unit: string): string {
  const text = Number.isInteger(value) ? String(value) : value.toFixed(1).replace('.', ',');
  return unit === '' ? text : `${text} ${unit}`;
}

export function InformationLayer({
  document: plan,
  session,
}: InformationLayerProps): React.JSX.Element {
  const { viewport } = session;

  const active: { id: Id; type: LayerType }[] = plan.layers
    .filter((layer) => layer.visible)
    .slice()
    .sort((a, b) => a.order - b.order)
    .flatMap((layer) => {
      const type = findLayerType(plan.catalog, layer.typeId);
      return type === null || type.representation.kind === 'objects'
        ? []
        : [{ id: layer.id, type }];
    });

  const zoneShapes = (
    layerId: Id,
    zone: Zone,
    fill: string,
    opacity: number,
  ): React.JSX.Element => (
    <Line
      key={`${layerId}-${zone.id}`}
      points={zone.polygon.flatMap((point) => modelToScreen(point, viewport))}
      closed
      fill={fill}
      opacity={opacity}
      listening={false}
    />
  );

  const paint = (layerId: Id, type: LayerType): React.JSX.Element[] => {
    const representation = type.representation;
    // Обычный слой рисуют слои объектов и геометрии, здесь ему делать нечего.
    if (representation.kind === 'objects') return [];

    if (representation.kind === 'zone-heat') {
      return plan.zones.flatMap((zone) => {
        const value = numberAttribute(zone.attributes, representation.attribute);
        if (value === null) return [];
        const ratio = Math.min(Math.max(value / representation.max, 0), 1);
        const [x, y] = modelToScreen(labelAnchor(zone.polygon), viewport);
        return [
          zoneShapes(
            layerId,
            zone,
            mixColors(representation.colors[0], representation.colors[1], ratio),
            0.7,
          ),
          <Text
            key={`${layerId}-${zone.id}-value`}
            x={x - 60}
            y={y + 8}
            width={120}
            align="center"
            text={formatValue(value, representation.unit)}
            fontSize={13}
            fontStyle="bold"
            fill={CAPTION_FILL}
            listening={false}
          />,
        ];
      });
    }

    if (representation.kind === 'zone-count') {
      return plan.zones.flatMap((zone) => {
        const value = numberAttribute(zone.attributes, representation.attribute);
        if (value === null) return [];
        const [x, y] = modelToScreen(labelAnchor(zone.polygon), viewport);
        return [
          <Circle
            key={`${layerId}-${zone.id}-badge`}
            x={x}
            y={y + 22}
            radius={16}
            fill={representation.color}
            opacity={0.9}
            listening={false}
          />,
          <Text
            key={`${layerId}-${zone.id}-count`}
            x={x - 40}
            y={y + 16}
            width={80}
            align="center"
            text={formatValue(value, representation.unit)}
            fontSize={12}
            fill={BADGE_TEXT}
            listening={false}
          />,
        ];
      });
    }

    const types = new Set(representation.objectTypeIds);
    return plan.objects
      .filter((object: Equipment) => types.has(object.typeId))
      .map((object) => {
        const angle =
          numberAttribute(object.attributes, representation.angleAttribute) ??
          representation.angle_deg;
        const range =
          numberAttribute(object.attributes, representation.rangeAttribute) ??
          representation.range_m;
        const sector = viewSector(object.position, object.rotation_deg, angle, range);
        return (
          <Line
            key={`${layerId}-${object.id}-sector`}
            points={sector.flatMap((point) => modelToScreen(point, viewport))}
            closed
            fill={representation.color}
            opacity={0.22}
            stroke={representation.color}
            strokeWidth={1}
            listening={false}
          />
        );
      });
  };

  return (
    <Layer listening={false}>
      {active.flatMap(({ id, type }) => paint(id, type))}

      {active.map((entry, index) => (
        <Text
          key={`caption-${entry.id}`}
          x={12}
          y={12 + index * 16}
          text={`${entry.type.label}: числа синтетические`}
          fontSize={12}
          fill={CAPTION_FILL}
          listening={false}
        />
      ))}
    </Layer>
  );
}
