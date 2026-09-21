/**
 * U-snap-target (D-224): маркер цели привязки под курсором, пока рисуют точки.
 *
 * Язык тот же, что у линии цели при переносе объекта (D-215), — иначе в
 * редакторе было бы два разных способа сказать одно и то же: направляющая
 * плана сплошная `#E64980`, узел сетки — пунктир `#868E96`, обе линии идут
 * через весь холст, чтобы партнёр нашёлся и в трёх метрах. Цвет отличает
 * направляющую от сетки, но не зону от стены, поэтому рядом с точкой стоит
 * подпись: она и закрывает находку operator №5.
 *
 * Слой смонтирован всегда и пуст, пока цели нет: добавление и удаление
 * Konva-слоя заставляет сцену перерисовать все слои (D-177). Своё состояние
 * маркер не держит — его кадр приходит каналом `snap-marker.ts`.
 *
 * Известное ограничение: размера холста у слоя нет (читать его в рендере
 * запрещает правило React о ссылках, а держать в состоянии — правило о
 * setState в эффекте), поэтому подпись всегда лежит справа снизу от точки и у
 * самого правого края холста обрезается.
 */

import { Circle, Label, Layer, Line, Tag, Text } from 'react-konva';
import type { PlanGeometryLayerProps } from '../../contracts/ui';
import type { SnapTarget } from '../../domain/geometry';
import { modelToScreen } from '../../domain/geometry';
import { hintCaption, useSnapHint } from './snap-marker';

/** Цвета и начертание — из D-215, один в один с линией цели при переносе. */
const GUIDE_STROKE = '#E64980';
const GRID_STROKE = '#868E96';
const GRID_DASH = [4, 4];

const CAPTION_FILL = '#212529';
const CAPTION_FONT_PX = 11;
const CAPTION_GAP_PX = 10;

/**
 * Половина длины линии цели в пикселях сцены. Линия должна пересекать холст
 * целиком (D-215), а размера холста у слоя нет — есть только точка на нём;
 * отрезок в пять тысяч пикселей в обе стороны заведомо длиннее любого окна, а
 * лишнее отрежет сам canvas. Не «бесконечность»: пунктир длиной в сто тысяч
 * пикселей — это десятки тысяч штрихов на каждый кадр.
 */
const REACH_PX = 5000;

type Viewport = PlanGeometryLayerProps['session']['viewport'];

function strokeOf(target: SnapTarget): string {
  return target === 'grid' ? GRID_STROKE : GUIDE_STROKE;
}

function dashOf(target: SnapTarget): number[] | undefined {
  return target === 'grid' ? GRID_DASH : undefined;
}

export function SnapMarkerLayer({ viewport }: { viewport: Viewport }): React.JSX.Element {
  const hint = useSnapHint();

  const content = (): React.JSX.Element | null => {
    if (hint === null) return null;
    const [x, y] = modelToScreen(hint.point, viewport);
    const caption = hintCaption(hint);

    return (
      <>
        {hint.x === null ? null : (
          <Line
            name={`snap-marker-x-${hint.x.target}`}
            points={[x, y - REACH_PX, x, y + REACH_PX]}
            stroke={strokeOf(hint.x.target)}
            strokeWidth={1}
            dash={dashOf(hint.x.target)}
            listening={false}
          />
        )}
        {hint.y === null ? null : (
          <Line
            name={`snap-marker-y-${hint.y.target}`}
            points={[x - REACH_PX, y, x + REACH_PX, y]}
            stroke={strokeOf(hint.y.target)}
            strokeWidth={1}
            dash={dashOf(hint.y.target)}
            listening={false}
          />
        )}
        <Circle
          name="snap-marker-point"
          x={x}
          y={y}
          radius={3.5}
          fill="#FFFFFF"
          stroke={strokeOf(hint.x?.target ?? hint.y?.target ?? 'grid')}
          strokeWidth={1.5}
          listening={false}
        />
        {caption === null ? null : (
          <Label
            name="snap-marker-caption"
            x={x + CAPTION_GAP_PX}
            y={y + CAPTION_GAP_PX}
            listening={false}
          >
            {/* Непрозрачная плашка — та же техника контраста, что у подписи
                объекта (D-216): подпись читается и поверх зоны, и поверх стены. */}
            <Tag fill="#FFFFFF" opacity={0.9} cornerRadius={2} />
            <Text text={caption} fontSize={CAPTION_FONT_PX} fill={CAPTION_FILL} padding={3} />
          </Label>
        )}
      </>
    );
  };

  return (
    <Layer name="snap-marker" listening={false}>
      {content()}
    </Layer>
  );
}
