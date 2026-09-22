/**
 * Названия зон — отдельным слоем поверх оборудования.
 *
 * Раньше подписи зон рисовались вместе с полом и стенами, то есть **под**
 * объектами: стоило поставить стеллаж или ряд стульев туда, куда легла
 * подпись, и название зоны пропадало целиком. Правило «уйти от объекта»
 * (`zone-label.ts`, D-216) спасает не всегда — в плотно заставленной зоне
 * свободной строки может не быть вовсе, и оно честно об этом предупреждает.
 *
 * Поэтому подпись поднята над оборудованием и сделана полупрозрачной. Оба
 * свойства нужны вместе: поверх — чтобы название зоны было видно всегда,
 * полупрозрачно — чтобы оно не закрывало то, что под ним, и читалось как
 * надпись на полу, а не как ещё один объект плана. Уход от объектов остаётся:
 * чистое место лучше наложения, и полупрозрачность — запасной вариант, а не
 * замена.
 *
 * Слой ничего не слушает: подпись не должна перехватывать клик по объекту,
 * который под ней лежит.
 */

import { useMemo } from 'react';
import { Layer, Text } from 'react-konva';
import type { PlanDocument, Viewport, Zone } from '../../contracts/model';
import type { BoundingBox } from '../../domain/geometry';
import { boundingBox, footprint, modelToScreen } from '../../domain/geometry';
import { zoneDepth } from '../../domain/relations';
import { zoneLabelAnchor } from './zone-label';
import { zoneNameStyle } from './zone-name-color';
/**
 * Экспортированы, а не только локальные: `InformationLayer` (D-241) держит
 * свою копию этих трёх чисел для расчёта места под значение слоя рядом с
 * именем зоны и не может импортировать `plan-tools` напрямую
 * (`eslint.config.js`), поэтому `tests/zone-name-anchor-sync.test.ts`
 * сверяет копию с настоящими числами отсюда, а не с их пересказом в самом
 * тесте.
 */
export const ZONE_LABEL_FONT_PX = 13;
export const ZONE_LABEL_LETTER_SPACING = 0.4;
export const ZONE_LABEL_BOX_WIDTH = 118;

/**
 * Непрозрачность подписи. 0,55 подобрано под самый трудный случай — тёмную
 * заливку оборудования под названием: выше подпись начинает спорить с
 * объектом за внимание, ниже — теряется на пёстром полу зоны.
 */
const ZONE_LABEL_OPACITY = 0.55;

export type ZoneNameLayerProps = {
  document: PlanDocument;
  viewport: Viewport;
};

export function ZoneNameLayer({ document: plan, viewport }: ZoneNameLayerProps): React.JSX.Element {
  const visibleLayers = useMemo(
    () => new Set(plan.layers.filter((layer) => layer.visible).map((layer) => layer.id)),
    [plan.layers],
  );

  // В метрах модели, а не в пикселях: панорамирование и зум перерисовывают
  // слой каждый кадр (D-190), а от них эти числа не зависят.
  const objectBoxes: BoundingBox[] = useMemo(
    () =>
      plan.objects
        .filter((object) => visibleLayers.has(object.layerId))
        .map((object) => boundingBox(footprint(object))),
    [plan.objects, visibleLayers],
  );

  const anchors = useMemo(
    () => new Map(plan.zones.map((zone) => [zone.id, zoneLabelAnchor(zone.polygon, objectBoxes)])),
    [plan.zones, objectBoxes],
  );

  // Стиль по уровню вложенности (D-250, D-279); глубина — по всем зонам
  // плана, а не только видимым: скрытый родитель не делает вложенную зону корнем.
  const styles = useMemo(
    () => new Map(plan.zones.map((zone) => [zone.id, zoneNameStyle(zoneDepth(zone.id, plan.zones))])),
    [plan.zones],
  );

  const zones: Zone[] = plan.zones.filter((zone) => visibleLayers.has(zone.layerId));

  return (
    <Layer listening={false} name="zone-names">
      {zones.map((zone) => {
        const anchor = anchors.get(zone.id);
        if (anchor === undefined) return null;
        const [x, y] = modelToScreen(anchor, viewport);
        const style = styles.get(zone.id) ?? zoneNameStyle(0);
        return (
          <Text
            key={`label-${zone.id}`}
            name="zone-name"
            id={`zone-name-${zone.id}`}
            x={x - ZONE_LABEL_BOX_WIDTH / 2}
            y={y - ZONE_LABEL_FONT_PX / 2}
            width={ZONE_LABEL_BOX_WIDTH}
            align="center"
            text={zone.name.toLocaleUpperCase('ru')}
            fontSize={ZONE_LABEL_FONT_PX}
            fontStyle={style.fontStyle}
            letterSpacing={ZONE_LABEL_LETTER_SPACING}
            fill={style.fill}
            opacity={ZONE_LABEL_OPACITY}
            listening={false}
          />
        );
      })}
    </Layer>
  );
}
