import type { Id, Layer } from '../contracts/model';

/**
 * Первый обычный незапертый слой, в который разрешено записывать зоны и
 * оборудование. Информационные слои только показывают данные поверх плана.
 */
export function editableContentLayer(
  layers: readonly Layer[],
  excludedId: Id | null = null,
): Layer | undefined {
  return layers.find(
    (layer) => layer.id !== excludedId && !layer.locked && layer.typeId === null,
  );
}
