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

import { useMemo } from 'react';
import { Layer, Line, Rect, Shape, Text } from 'react-konva';
import type { Id, LayerType, Point, Polygon, Zone } from '../../contracts/model';
import type { InformationLayerProps } from '../../contracts/ui';
import { findLayerType } from '../../domain/catalog';
import { type BoundingBox, boundingBox, footprint, modelToScreen, viewSector } from '../../domain/geometry';
import { labelWidth, placeLabels, type Box } from './label-layout';
import { formatValue, legendLine, legendOf } from './legend';
import { heatRegions } from './heat-regions';
import { zoneNameAnchor } from './zone-name-anchor';

const CAPTION_FILL = '#495057';
const LABEL_BACKGROUND = '#FFFFFF';
const LABEL_FONT = 11;
const LABEL_HEIGHT = 16;
/** Space between labels: the 1 px stroke is drawn half outside the box. */
const LABEL_GAP = 3;
const SWATCH = 8;
const LEGEND_FONT = 12;
const LEGEND_ROW = 18;
/**
 * The zone name drawn by `ZoneNameLayer` (D-216/D-237, `ZONE_LABEL_FONT_PX` /
 * `ZONE_LABEL_BOX_WIDTH` / `ZONE_LABEL_LETTER_SPACING` in
 * `src/features/plan-tools/ZoneNameLayer.tsx`): 13 px, upper-case,
 * letter-spaced, wrapped into a 118 px column. Mirrored here as plain
 * numbers — same duplication reasoning as `zone-name-anchor.ts`; kept in
 * sync by `tests/zone-name-anchor-sync.test.ts`, which imports the real
 * constants rather than a second hand-copied set of numbers (D-241 review).
 */
const ZONE_NAME_FONT = 13;
const ZONE_NAME_COLUMN = 118;
const ZONE_NAME_LETTER_SPACING = 0.4;
/**
 * Height reserved per wrapped line of a zone name, in screen px. Konva's own
 * default `lineHeight` is 1 — a real line is exactly `ZONE_NAME_FONT` (13) px
 * tall — so this is a deliberate margin, not a measurement: `1.25×` covers
 * glyph ascent/descent past the nominal font box, the same margin
 * `labelWidth` already takes on width. A too-small reserve lets a two-line
 * name's second line poke into whatever a caller places right below it.
 */
const ZONE_NAME_LINE_HEIGHT = Math.round(ZONE_NAME_FONT * 1.25);

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

/** Colour that stands for the layer in its labels and in the canvas legend. */
function layerColor(type: LayerType): string {
  const representation = type.representation;
  if (representation.kind === 'zone-heat') return representation.colors[1];
  if (representation.kind === 'objects') return CAPTION_FILL;
  return representation.color;
}

/**
 * Screen-space box the geometry layer's zone name actually occupies at
 * `anchor` (D-216 draws it centred there, upper-case, letter-spaced, wrapped
 * into `ZONE_NAME_COLUMN`). `labelWidth`'s own margin already covers most of
 * the gap between its plain-text estimate and Konva's real measurement; the
 * explicit `letterSpacing` term on top accounts for the one difference that
 * margin was not sized for.
 *
 * Exported so `InformationLayer.test.tsx` can compute the same box the
 * component itself uses, rather than a hand-rolled approximation that could
 * drift from production and stop catching a regression (D-241 review).
 */
export function zoneNameBox(zone: Zone, [x, y]: [number, number]): Box {
  const upper = zone.name.toLocaleUpperCase('ru');
  const full = labelWidth(upper, ZONE_NAME_FONT) + upper.length * ZONE_NAME_LETTER_SPACING;
  const lines = Math.ceil(full / ZONE_NAME_COLUMN);
  const width = Math.min(full, ZONE_NAME_COLUMN);
  return { x: x - width / 2, y: y - ZONE_NAME_FONT / 2, width, height: lines * ZONE_NAME_LINE_HEIGHT };
}

type ZoneLabel = { key: string; text: string; color: string; request: Box };

export function InformationLayer({
  document: plan,
  session,
}: InformationLayerProps): React.JSX.Element {
  const { viewport } = session;
  const screen = (point: Point): [number, number] => modelToScreen(point, viewport);

  // Footprints a zone name steers around (D-216) — same input `ZoneNameLayer`
  // feeds its real `zoneLabelAnchor`, so this layer's copy (`zoneNameAnchor`,
  // D-241) lands on the same point. Model metres and independent of the
  // viewport, so a pan or zoom frame does not pay for it again.
  const objectBoxes: BoundingBox[] = useMemo(() => {
    const visibleLayers = new Set(plan.layers.filter((layer) => layer.visible).map((layer) => layer.id));
    return plan.objects
      .filter((object) => visibleLayers.has(object.layerId))
      .map((object) => boundingBox(footprint(object)));
  }, [plan.objects, plan.layers]);
  const zoneAnchors = useMemo(
    () => new Map(plan.zones.map((zone) => [zone.id, zoneNameAnchor(zone.polygon, objectBoxes)])),
    [plan.zones, objectBoxes],
  );
  // `zoneAnchors` is built from `plan.zones` itself right above, so every
  // zone passed in below is already a key: the map is never missing one.
  const anchorOf = (zone: Zone): Point => zoneAnchors.get(zone.id) as Point;

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

  // Canvas legend, top left: one row per active layer.
  const legendRows = active.map((entry, index) => ({
    ...entry,
    legend: legendOf(entry.type),
    text: legendLine(entry.type, legendOf(entry.type)),
    y: 12 + index * LEGEND_ROW,
  }));
  const legendWidth = Math.max(0, ...legendRows.map((row) => 44 + labelWidth(row.text, LEGEND_FONT)));
  const legendBox: Box = { x: 6, y: 6, width: legendWidth, height: legendRows.length * LEGEND_ROW + 6 };

  const ring = (polygon: Polygon): number[] => polygon.flatMap((point) => screen(point));

  const fills: React.JSX.Element[] = [];
  const labels: ZoneLabel[] = [];

  for (const { id: layerId, type } of active) {
    const representation = type.representation;
    // Ordinary layers are drawn by the geometry and equipment layers.
    if (representation.kind === 'objects') continue;

    if (representation.kind === 'zone-heat' || representation.kind === 'zone-count') {
      const valueOf = (zone: Zone): number | null =>
        numberAttribute(zone.attributes, representation.attribute);

      for (const zone of plan.zones) {
        const value = valueOf(zone);
        if (value === null) continue;
        const text = formatValue(value, representation.unit);
        const nameBox = zoneNameBox(zone, screen(anchorOf(zone)));
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
          const ratio = Math.min(Math.max(region.value / representation.max, 0), 1);
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
              fill={mixColors(representation.colors[0], representation.colors[1], ratio)}
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
  }

  // Zone names of the geometry layer and the legend are fixed; labels move around them.
  const obstacles: Box[] = [
    ...(legendRows.length === 0 ? [] : [legendBox]),
    ...plan.zones.map((zone) => zoneNameBox(zone, screen(anchorOf(zone)))),
  ];
  const placed = placeLabels(
    obstacles,
    labels.map((label) => label.request),
    LABEL_GAP,
  );

  return (
    <Layer listening={false}>
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
        row.legend.kind === 'scale' ? (
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
          key={`caption-${row.id}`}
          name="info-caption"
          x={50}
          y={row.y + 1}
          text={row.text}
          fontSize={LEGEND_FONT}
          fill={CAPTION_FILL}
          listening={false}
        />,
      ])}
    </Layer>
  );
}
