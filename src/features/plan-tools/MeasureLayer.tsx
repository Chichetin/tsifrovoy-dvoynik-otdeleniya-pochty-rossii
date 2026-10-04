/**
 * Линейка на холсте: отрезок между двумя точками и его длина.
 *
 * Слой смонтирован всегда и пуст, пока не меряют: добавление и удаление
 * Konva-слоя заставляет сцену перерисовать все слои (D-177). Своё состояние
 * линейка не держит — кадр приходит каналом `measure.ts`.
 *
 * Ничего не слушает: линейка лежит поверх плана и не должна перехватывать
 * клик по тому, что под ней.
 */

import { Circle, Group, Label, Line, Tag, Text } from 'react-konva';
import type { Viewport } from '../../contracts/model';
import { modelToScreen } from '../../domain/geometry';
import { measurementCaption, useMeasurement } from './measure';

/** Тот же синий, что у черновика контура: это линия жеста, а не часть плана. */
const MEASURE_STROKE = '#1971C2';
const MEASURE_DASH = [6, 4];
const CAPTION_FONT_PX = 12;
const CAPTION_GAP_PX = 10;

export function MeasureLayer({ viewport }: { viewport: Viewport }): React.JSX.Element {
  const measurement = useMeasurement();

  const content = (): React.JSX.Element | null => {
    if (measurement === null) return null;
    const [x1, y1] = modelToScreen(measurement.from, viewport);
    const [x2, y2] = modelToScreen(measurement.to, viewport);

    return (
      <>
        <Line
          name="measure-line"
          points={[x1, y1, x2, y2]}
          stroke={MEASURE_STROKE}
          strokeWidth={1.5}
          dash={MEASURE_DASH}
          listening={false}
        />
        {[
          [x1, y1],
          [x2, y2],
        ].map(([x, y], index) => (
          <Circle
            key={index === 0 ? 'measure-from' : 'measure-to'}
            name="measure-end"
            x={x}
            y={y}
            radius={3.5}
            fill="#FFFFFF"
            stroke={MEASURE_STROKE}
            strokeWidth={1.5}
            listening={false}
          />
        ))}
        {/* Плашка у середины отрезка: непрозрачный фон — та же техника
            контраста, что у подписи объекта (D-216), число читается и поверх
            тёмной стены. */}
        <Label
          x={(x1 + x2) / 2 + CAPTION_GAP_PX}
          y={(y1 + y2) / 2 - CAPTION_GAP_PX}
          listening={false}
        >
          <Tag fill="#FFFFFF" opacity={0.92} cornerRadius={2} stroke={MEASURE_STROKE} strokeWidth={1} />
          <Text
            name="measure-caption"
            text={measurementCaption(measurement)}
            fontSize={CAPTION_FONT_PX}
            fontStyle="500"
            fill="#212529"
            padding={4}
          />
        </Label>
      </>
    );
  };

  return (
    <Group name="measure" listening={false}>
      {content()}
    </Group>
  );
}
