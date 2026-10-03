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
import { ZONE_CAPTION_FONT, ZONE_CAPTION_SPACING, zoneCaptionBoxes } from '../../domain/zone-caption-layout';
import { zoneDepth } from '../../domain/relations';
import { zoneNameStyle } from './zone-name-color';
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

  const captions = useMemo(() => zoneCaptionBoxes(plan, viewport), [plan, viewport]);

  // Стиль по уровню вложенности (D-250, D-280); глубина — по всем зонам
  // плана, а не только видимым: скрытый родитель не делает вложенную зону корнем.
  const styles = useMemo(
    () => new Map(plan.zones.map((zone) => [zone.id, zoneNameStyle(zoneDepth(zone.id, plan.zones))])),
    [plan.zones],
  );

  const zones: Zone[] = plan.zones.filter((zone) => visibleLayers.has(zone.layerId));

  return (
    <Layer listening={false} name="zone-names">
      {zones.map((zone) => {
        const box = captions.get(zone.id);
        if (box === undefined) return null;
        const style = styles.get(zone.id) ?? zoneNameStyle(0);
        return (
          <Text
            key={`label-${zone.id}`}
            name="zone-name"
            id={`zone-name-${zone.id}`}
            x={box.x}
            y={box.y}
            width={box.width}
            align="center"
            text={zone.name.toLocaleUpperCase('ru')}
            fontSize={ZONE_CAPTION_FONT}
            fontStyle={style.fontStyle}
            letterSpacing={ZONE_CAPTION_SPACING}
            fill={style.fill}
            opacity={ZONE_LABEL_OPACITY}
            listening={false}
          />
        );
      })}
    </Layer>
  );
}
