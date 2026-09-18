/**
 * U03: одно правило удаления на клавишу и на кнопку панели.
 *
 * Клавиша Delete (и Backspace — на ноутбуке без отдельной Delete он и есть
 * «удалить») и кнопка «Удалить …» шлют одну и ту же команду, поэтому решение
 * «что удаляем и удаляем ли» живёт здесь, а не отдельно в слое и в панели.
 *
 * Скрытый слой закрывает содержимое от правок (D-078): зону, которой не видно
 * на плане, клавиша не удаляет — и говорит почему. Помещение не удаляется
 * вовсе, объекты удаляет их собственный слой (U04).
 */

import type { Command } from '../../contracts/commands';
import type { PlanDocument, Ref } from '../../contracts/model';
import { HIDDEN_ZONE_NOTICE } from './notice';

export type DeleteIntent =
  | { kind: 'delete'; command: Command; label: string }
  | { kind: 'refused'; notice: string };

/** Клавиши, которыми удаляют; поле ввода фильтрует вызывающий. */
export function isDeleteKey(key: string): boolean {
  return key === 'Delete' || key === 'Backspace';
}

function visible(plan: PlanDocument, layerId: string): boolean {
  const layer = plan.layers.find((entry) => entry.id === layerId);
  return layer === undefined || layer.visible;
}

/** Что сделает удаление при текущем выборе; null — выбор не наш или его уже нет. */
export function deleteIntent(selection: Ref | null, plan: PlanDocument): DeleteIntent | null {
  if (selection === null) return null;

  if (selection.kind === 'zone') {
    const zone = plan.zones.find((entry) => entry.id === selection.id);
    if (zone === undefined) return null;
    if (!visible(plan, zone.layerId)) return { kind: 'refused', notice: HIDDEN_ZONE_NOTICE };
    return { kind: 'delete', command: { type: 'zone.delete', id: zone.id }, label: 'зону' };
  }

  if (selection.kind === 'wall') {
    const wall = plan.walls.find((entry) => entry.id === selection.id);
    if (wall === undefined) return null;
    return { kind: 'delete', command: { type: 'wall.delete', id: wall.id }, label: 'перегородку' };
  }

  if (selection.kind === 'opening') {
    const opening = plan.openings.find((entry) => entry.id === selection.id);
    if (opening === undefined) return null;
    return { kind: 'delete', command: { type: 'opening.delete', id: opening.id }, label: 'проём' };
  }

  return null;
}
