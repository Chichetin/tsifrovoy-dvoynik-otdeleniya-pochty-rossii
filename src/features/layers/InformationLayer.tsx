/**
 * U05 (представление): информационные слои поверх плана.
 *
 * Слой ничего не содержит и ничего не меняет: он читает атрибуты зон и
 * объектов и рисует их. Что именно рисовать, решает справочник — тип слоя
 * приносит вид представления, атрибут и цвета, поэтому новый слой «очередь»
 * появился рядом с «нагрузкой» одной записью JSON.
 *
 * Числа в этих слоях синтетические: их вводит человек в панели слоёв.
 * Происхождение чисел раскрывается на защите и в README, а не подписью на
 * холсте или в панели.
 */

import { Fragment, useMemo } from 'react';
import { Group, Line, Rect, Shape, Text } from 'react-konva';
import type { Id, LayerType, Point, Polygon, Zone } from '../../contracts/model';
import type { InformationLayerProps } from '../../contracts/ui';
import { findLayerType } from '../../domain/catalog';
import { modelToScreen, viewSector } from '../../domain/geometry';
import { heatColor } from '../../domain/heat-color';
import { labelWidth, placeLabels, type Box } from './label-layout';
import { heatRegions } from '../../domain/heat-regions';
import { BLIND_SPOT, blindSpotLine, formatValue, legendLine, legendOf } from '../../domain/layer-legend';
import { visibleCoverage } from './coverage';
import { zoneCaptionBoxes } from '../../domain/zone-caption-layout';

const CAPTION_FILL = '#495057';
const LABEL_BACKGROUND = '#FFFFFF';
const LABEL_FONT = 11;
const LABEL_HEIGHT = 16;
/** Space between labels: the 1 px stroke is drawn half outside the box. */
const LABEL_GAP = 3;
const SWATCH = 8;
const LEGEND_FONT = 12;
const LEGEND_ROW = 18;
function numberAttribute(
  attributes: Record<string, string | number | boolean | null>,
  key: string,
): number | null {
  const value = attributes[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Colour that stands for the layer in its labels and in the canvas legend. */
function layerColor(type: LayerType): string {
  const representation = type.representation;
  if (representation.kind === 'zone-heat') return representation.colors[1];
  if (representation.kind === 'objects') return CAPTION_FILL;
  if (representation.kind === 'object-color') return representation.values[0]?.color ?? CAPTION_FILL;
  return representation.color;
}

type ZoneLabel = { key: string; text: string; color: string; request: Box };

export function InformationLayer({
  document: plan,
  session,
}: InformationLayerProps): React.JSX.Element {
  const { viewport } = session;
  // Zone names are placed once, by `zoneCaptionBoxes` (D-348): `ZoneNameLayer`
  // draws them there and this layer puts values under them. A zone on a hidden
  // layer has no box: no name, so no value under it and no reserved space.
  const captionBoxes = useMemo(() => zoneCaptionBoxes(plan, viewport), [plan, viewport]);
  const screen = (point: Point): [number, number] => modelToScreen(point, viewport);

  // Coverage of client zones (D-306/D-307): once per document revision — a pan
  // or zoom frame redraws the strips, it does not count the squares again.
  const coverage = useMemo(
    () => visibleCoverage({ layers: plan.layers, zones: plan.zones, objects: plan.objects, catalog: plan.catalog }),
    [plan.layers, plan.zones, plan.objects, plan.catalog],
  );

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

  // Canvas legend, top left: one row per active layer, plus the blind-spot
  // hatch under a sector layer that has client zones to cover.
  const legendRows = active
    .flatMap((entry) => {
      const row = { ...entry, key: entry.id, blind: false, legend: legendOf(entry.type), text: legendLine(entry.type, legendOf(entry.type)) };
      const percent = coverage.get(entry.type.id)?.total.percent ?? null;
      if (percent === null) return [row];
      return [row, { ...row, key: `${entry.id}-blind`, blind: true, text: blindSpotLine(percent) }];
    })
    .map((row, index) => ({
      ...row,
      y: 12 + index * LEGEND_ROW,
      textX: !row.blind && row.legend.kind === 'palette' ? Math.max(50, 17 + row.legend.values.length * 9) : 50,
    }));
  const legendWidth = Math.max(0, ...legendRows.map((row) => row.textX - 6 + labelWidth(row.text, LEGEND_FONT)));
  const legendBox: Box = { x: 6, y: 6, width: legendWidth, height: legendRows.length * LEGEND_ROW + 6 };

  const ring = (polygon: Polygon): number[] => polygon.flatMap((point) => screen(point));

  const fills: React.JSX.Element[] = [];
  const labels: ZoneLabel[] = [];

  for (const { id: layerId, type } of active) {
    const representation = type.representation;
    // Ordinary layers are drawn by the geometry and equipment layers.
    if (representation.kind === 'objects') continue;
    if (representation.kind === 'object-color') continue;

    if (representation.kind === 'zone-heat' || representation.kind === 'zone-count') {
      const valueOf = (zone: Zone): number | null =>
        numberAttribute(zone.attributes, representation.attribute);

      for (const zone of plan.zones) {
        const value = valueOf(zone);
        if (value === null) continue;
        const text = formatValue(value, representation.unit);
        const nameBox = captionBoxes.get(zone.id);
        if (nameBox === undefined) continue;
        const x = nameBox.x + nameBox.width / 2;
        const width = labelWidth(text, LABEL_FONT) + SWATCH + 4;
        labels.push({
          key: `${layerId}-${zone.id}`,
          text,
          color: layerColor(type),
          // Just below the zone name's real box; collisions are resolved after all layers are in.
          request: { x: x - width / 2, y: nameBox.y + nameBox.height + LABEL_GAP, width, height: LABEL_HEIGHT },
        });
      }

      if (representation.kind === 'zone-heat') {
        // Deepest zone with a value paints each point; nested zones are holes (D-138).
        for (const region of heatRegions(plan.zones, representation.attribute)) {
          const rings = region.rings.map(ring);
          fills.push(
            <Shape
              key={`${layerId}-${region.zoneId}`}
              name="info-fill"
              sceneFunc={(context, shape) => {
                context.beginPath();
                for (const points of rings) {
                  context.moveTo(points[0] ?? 0, points[1] ?? 0);
                  for (let i = 2; i < points.length; i += 2) {
                    context.lineTo(points[i] ?? 0, points[i + 1] ?? 0);
                  }
                  context.closePath();
                }
                context.fillStrokeShape(shape);
              }}
              fill={heatColor(representation.colors, region.value, representation.max)}
              opacity={0.7}
              listening={false}
            />,
          );
        }
      }
      continue;
    }

    const types = new Set(representation.objectTypeIds);
    for (const object of plan.objects) {
      if (!types.has(object.typeId)) continue;
      const angle =
        numberAttribute(object.attributes, representation.angleAttribute) ?? representation.angle_deg;
      const range =
        numberAttribute(object.attributes, representation.rangeAttribute) ?? representation.range_m;
      const sector = viewSector(object.position, object.rotation_deg, angle, range);
      fills.push(
        <Line
          key={`${layerId}-${object.id}-sector`}
          points={ring(sector)}
          closed
          fill={representation.color}
          opacity={0.22}
          stroke={representation.color}
          strokeWidth={1}
          // D-190: полупрозрачная фигура с заливкой и обводкой иначе рисуется
          // через буферный холст размером со сцену — очистка и полная копия на
          // каждую камеру при любой перерисовке слоя.
          perfectDrawEnabled={false}
          listening={false}
        />,
      );
    }

    // Blind spots of client zones: hatched strips, one shape for the whole layer.
    const blind = coverage.get(type.id)?.blind ?? [];
    if (blind.length > 0) {
      const rects = blind.map((strip) => {
        const [ax, ay] = screen([strip.x, strip.y]);
        const [bx, by] = screen([strip.x + strip.width, strip.y + strip.height]);
        return { x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
      });
      const minX = Math.min(...rects.map((rect) => rect.x));
      const minY = Math.min(...rects.map((rect) => rect.y));
      const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
      const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
      fills.push(
        <Shape
          key={`${layerId}-blind`}
          name="camera-blind"
          sceneFunc={(context, shape) => {
            context.beginPath();
            for (const rect of rects) context.rect(rect.x, rect.y, rect.width, rect.height);
            context.fillStrokeShape(shape);
            // Diagonal lines, clipped to the strips: a hatch reads as «not seen»
            // on any zone colour and does not hide what stands there.
            context.save();
            context.clip();
            context.beginPath();
            const height = maxY - minY;
            const step = BLIND_SPOT.spacing_px;
            const first = Math.floor((minX - height) / step) * step;
            for (let x = first; x <= maxX; x += step) {
              context.moveTo(x, maxY);
              context.lineTo(x + height, minY);
            }
            context.setAttr('strokeStyle', BLIND_SPOT.line);
            context.setAttr('lineWidth', 1);
            context.stroke();
            context.restore();
          }}
          fill={BLIND_SPOT.tint}
          // Extent of the hatch for hit-free bounds: Konva cannot measure a sceneFunc.
          width={maxX - minX}
          height={maxY - minY}
          perfectDrawEnabled={false}
          listening={false}
        />,
      );
    }
  }

  // Zone names of the geometry layer and the legend are fixed; labels move around them.
  const obstacles: Box[] = [
    ...(legendRows.length === 0 ? [] : [legendBox]),
    ...captionBoxes.values(),
  ];
  const placed = placeLabels(
    obstacles,
    labels.map((label) => label.request),
    LABEL_GAP,
  );

  return (
    <Group listening={false}>
      {fills}

      {labels.map((label, index) => {
        const box = placed[index] ?? label.request;
        return (
          <Rect
            key={`${label.key}-box`}
            name="info-label"
            x={box.x}
            y={box.y}
            width={box.width}
            height={box.height}
            cornerRadius={3}
            fill={LABEL_BACKGROUND}
            opacity={0.9}
            stroke={label.color}
            strokeWidth={1}
            perfectDrawEnabled={false}
            listening={false}
          />
        );
      })}
      {labels.flatMap((label, index) => {
        const box = placed[index] ?? label.request;
        return [
          <Rect
            key={`${label.key}-swatch`}
            x={box.x + 4}
            y={box.y + (LABEL_HEIGHT - SWATCH) / 2}
            width={SWATCH}
            height={SWATCH}
            fill={label.color}
            listening={false}
          />,
          <Text
            key={`${label.key}-text`}
            x={box.x + SWATCH + 6}
            y={box.y + 3}
            text={label.text}
            fontSize={LABEL_FONT}
            fontStyle="bold"
            fill={CAPTION_FILL}
            listening={false}
          />,
        ];
      })}

      {legendRows.length === 0 ? null : (
        <Rect
          name="info-legend"
          x={legendBox.x}
          y={legendBox.y}
          width={legendBox.width}
          height={legendBox.height}
          cornerRadius={4}
          fill={LABEL_BACKGROUND}
          opacity={0.85}
          listening={false}
        />
      )}
      {legendRows.flatMap((row) => [
        row.blind ? (
          <Shape
            key={`legend-${row.key}-hatch`}
            name="camera-blind-legend"
            x={12}
            y={row.y + 2}
            sceneFunc={(context, shape) => {
              const side = SWATCH + 2;
              context.beginPath();
              context.rect(0, 0, side, side);
              context.fillStrokeShape(shape);
              context.save();
              context.clip();
              context.beginPath();
              for (const offset of [-side / 2, 0, side / 2]) {
                context.moveTo(offset, side);
                context.lineTo(offset + side, 0);
              }
              context.setAttr('strokeStyle', BLIND_SPOT.color);
              context.setAttr('lineWidth', 1);
              context.stroke();
              context.restore();
            }}
            fill={BLIND_SPOT.tint}
            perfectDrawEnabled={false}
            listening={false}
          />
        ) : row.legend.kind === 'scale' ? (
          <Rect
            key={`legend-${row.id}-scale`}
            x={12}
            y={row.y + 3}
            width={32}
            height={9}
            fillLinearGradientStartPoint={{ x: 0, y: 0 }}
            fillLinearGradientEndPoint={{ x: 32, y: 0 }}
            fillLinearGradientColorStops={[0, row.legend.from, 1, row.legend.to]}
            listening={false}
          />
        ) : row.legend.kind === 'palette' ? (
          <Fragment key={`legend-${row.id}-palette`}>{row.legend.values.map((value, index) => (
            <Rect
              key={`legend-${row.id}-${value.value}`}
              x={12 + index * 9}
              y={row.y + 2}
              width={8}
              height={SWATCH + 2}
              fill={value.color}
              listening={false}
            />
          ))}</Fragment>
        ) : (
          <Rect
            key={`legend-${row.id}-swatch`}
            x={12}
            y={row.y + 2}
            width={SWATCH + 2}
            height={SWATCH + 2}
            fill={layerColor(row.type)}
            listening={false}
          />
        ),
        <Text
          key={`caption-${row.key}`}
          name="info-caption"
          x={row.textX}
          y={row.y + 1}
          text={row.text}
          fontSize={LEGEND_FONT}
          fill={CAPTION_FILL}
          listening={false}
        />,
      ])}
    </Group>
  );
}
