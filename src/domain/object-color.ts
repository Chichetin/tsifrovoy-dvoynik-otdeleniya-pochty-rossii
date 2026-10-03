/** Data-driven equipment colour layers. A visible layer only changes the view. */
import type { Attributes, LayerRepresentation, PlanDocument } from '../contracts/model';

export type ObjectColorRepresentation = Extract<LayerRepresentation, { kind: 'object-color' }>;

export function activeObjectColor(plan: PlanDocument): ObjectColorRepresentation | null {
  const visible = plan.layers
    .filter((layer) => layer.visible && layer.typeId !== null)
    .sort((a, b) => a.order - b.order);
  let active: ObjectColorRepresentation | null = null;
  for (const layer of visible) {
    const representation = plan.catalog.layerTypes.find((type) => type.id === layer.typeId)?.representation;
    if (representation?.kind === 'object-color') active = representation;
  }
  return active;
}

export function objectColorValue(
  representation: ObjectColorRepresentation,
  attributes: Attributes,
): { value: string; label: string; color: string } {
  const raw = attributes[representation.attribute];
  const value = typeof raw === 'string' ? raw : representation.defaultValue;
  const fallback = representation.values.find((option) => option.value === representation.defaultValue)
    ?? representation.values[0]
    ?? { value: representation.defaultValue, label: 'Не указано', color: '#868E96' };
  return representation.values.find((option) => option.value === value)
    ?? fallback;
}
