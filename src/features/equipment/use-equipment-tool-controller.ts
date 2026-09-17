/**
 * U04 (gesture): placing equipment from the library.
 *
 * One click, one object, with the catalog's default size, height and required
 * attributes. Nothing about the type is hard-coded here — a type added to
 * data/catalog is placeable the moment it appears in the library.
 */

import { useCallback } from 'react';
import type { Id } from '../../contracts/model';
import type { ToolController, UsePlanToolController, WorldPointer } from '../../contracts/ui';
import { defaultAttributes, findObjectType } from '../../domain/catalog';
import { snapPosition } from './transform';

function nextId(prefix: string, taken: Set<Id>): Id {
  for (let index = 1; ; index += 1) {
    const candidate = `${prefix}${index}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export const useEquipmentToolController: UsePlanToolController = ({
  document: plan,
  session,
  onCommand,
}): ToolController => {
  const tool = session.tool;

  const handlePointer = useCallback(
    (event: WorldPointer): void => {
      if (tool.kind !== 'object.place' || event.phase !== 'down') return;

      const type = findObjectType(plan.catalog, tool.typeId);
      // Только обычный слой: информационный слой — представление поверх плана
      // и ничего не содержит (D-063).
      const layer =
        plan.layers.find((entry) => !entry.locked && entry.typeId === null) ?? plan.layers[0];
      if (type === null || layer === undefined) return;

      const taken = new Set<Id>(plan.objects.map((object) => object.id));
      onCommand({
        type: 'object.put',
        object: {
          id: nextId('eq_', taken),
          typeId: type.id,
          label: type.label,
          // Centimetres, like every other gesture: the file stays readable.
          position: snapPosition(event.point),
          size_m: type.defaultSize_m,
          rotation_deg: 0,
          base_m: type.defaultBase_m,
          height_m: type.defaultHeight_m,
          zoneId: null,
          layerId: layer.id,
          attributes: defaultAttributes(type),
        },
      });
    },
    [onCommand, plan.catalog, plan.layers, plan.objects, tool],
  );

  return { handlePointer, cancel: () => undefined, draft: null };
};
