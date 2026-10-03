/**
 * U04 (gesture): placing equipment from the library.
 *
 * One click, one object, with the catalog's default size, height and required
 * attributes. Nothing about the type is hard-coded here — a type added to
 * data/catalog is placeable the moment it appears in the library.
 */

import { useCallback } from 'react';
import type { ToolController, UsePlanToolController, WorldPointer } from '../../contracts/ui';
import { findObjectType } from '../../domain/catalog';
import { newObject } from '../../domain/commands';
import { snapPosition } from './transform';
import { isWallMounted, wallMountPlacement } from './wall-mount';

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
      if (type === null) return;
      // Настенное оборудование (D-228) прижимается к ближайшей стене и
      // смотрит внутрь помещения: камера с `rotation_deg: 0` направляла бы
      // сектор обзора в стену, куда бы её ни поставили. Остальные типы
      // ставятся ровно под курсором, как раньше; повернуть руками можно и то,
      // и другое.
      const placement = isWallMounted(type)
        ? wallMountPlacement(plan.walls, plan.room.boundary, type.defaultSize_m, event.point)
        : null;
      // Id, layer, catalog defaults and the next inventory number (D-310) come
      // from one rule for every new object; one command — one undo removes all.
      const object = newObject(
        plan,
        type,
        {
          // Centimetres, like every other gesture: the file stays readable.
          position: placement?.position ?? snapPosition(event.point),
          rotation_deg: placement?.rotation_deg ?? 0,
        },
        session.retired,
      );
      if (object === null) return;
      onCommand({ type: 'object.put', object });
    },
    [onCommand, plan, session.retired, tool],
  );

  return { handlePointer, cancel: () => undefined, draft: null };
};
