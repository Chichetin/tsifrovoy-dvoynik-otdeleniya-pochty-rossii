/**
 * U04 (gesture): placing equipment from the library.
 *
 * One click, one object, with the catalog's default size, height and required
 * attributes. Nothing about the type is hard-coded here — a type added to
 * data/catalog is placeable the moment it appears in the library.
 */

import { useCallback } from 'react';
import type { ToolController, UsePlanToolController, WorldPointer } from '../../contracts/ui';
import { defaultAttributes, findObjectType } from '../../domain/catalog';
import { takenIds } from '../../domain/commands';
import { editableContentLayer } from '../../domain/content-layer';
import { nextObjectId } from './selection-edit';
import { snapPosition } from './transform';

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
      // No unlocked content layer: still address the first content layer, so
      // the store refuses with «слой заперт» and the person learns why nothing
      // was placed. A silent no-op is not an outcome (D-174 keeps content off
      // informational layers; it does not ask for silence).
      const layer =
        editableContentLayer(plan.layers) ?? plan.layers.find((entry) => entry.typeId === null);
      if (type === null || layer === undefined) return;

      // Ids of everything on the plan plus ids a delete retired this session:
      // the store refuses to resurrect the latter (D-019), so «удалить → поставить
      // снова» must not offer them. Один генератор с вставкой из буфера
      // (`nextObjectId`): два номерователя рядом рано или поздно выдадут один id.
      const taken = takenIds(plan, session.retired);
      onCommand({
        type: 'object.put',
        object: {
          id: nextObjectId(taken),
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
    [onCommand, plan, session.retired, tool],
  );

  return { handlePointer, cancel: () => undefined, draft: null };
};
