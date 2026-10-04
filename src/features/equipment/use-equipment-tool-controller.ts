/**
 * U04 (gesture): placing equipment from the library.
 *
 * One click, one object, with the catalog's default size, height and required
 * attributes. Nothing about the type is hard-coded here — a type added to
 * data/catalog is placeable the moment it appears in the library. While the
 * type is armed the pointer carries a silhouette that says, before the click,
 * whether the store will take the object (#26).
 */

import { useCallback, useEffect } from 'react';
import type { ToolController, UsePlanToolController, WorldPointer } from '../../contracts/ui';
import { findObjectType } from '../../domain/catalog';
import { placedObject, placementGhost, placementVerdict } from './placement-ghost';

export const useEquipmentToolController: UsePlanToolController = ({
  document: plan,
  session,
  onCommand,
}): ToolController => {
  const tool = session.tool;

  // The verdict belongs to one type on one plan: another type, another plan or
  // an edit (a layer unlocked, an undo) makes the silhouette stale, and it
  // comes back with the next pointer move.
  const armedType = tool.kind === 'object.place' ? tool.typeId : null;
  useEffect(() => {
    placementGhost.publish(null);
  }, [armedType, plan]);

  const handlePointer = useCallback(
    (event: WorldPointer): void => {
      if (tool.kind !== 'object.place' || (event.phase !== 'down' && event.phase !== 'move')) return;

      const type = findObjectType(plan.catalog, tool.typeId);
      if (type === null) return;
      const object = placedObject(plan, type, event.point, session.retired);
      if (event.phase === 'move') {
        placementGhost.publish(
          object === null ? null : { object, ...placementVerdict(plan, object, session.retired) },
        );
        return;
      }
      if (object === null) return;
      onCommand({ type: 'object.put', object });
    },
    [onCommand, plan, session.retired, tool],
  );

  return { handlePointer, cancel: () => undefined, draft: null };
};
