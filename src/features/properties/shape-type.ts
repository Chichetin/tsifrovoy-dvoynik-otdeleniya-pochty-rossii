/**
 * «Сохранить форму как новый тип» (D-279): the object's own outline becomes a
 * catalog type, so the next object from the library is placed with it.
 *
 * The new type copies its source type — category, colour, physics,
 * attributes, height — and takes the object's outline and size; its id is
 * minted by the one rule for new ids, its provenance says a person drew it.
 * The result goes to the store as one `catalog.replace`, like every catalog
 * edit (D-021), and `validateCatalog` there has the last word.
 */

import type { Catalog, Equipment, Id } from '../../contracts/model';
import { sameOutline, typeOutline } from '../../contracts/outline';
import { findObjectType } from '../../domain/catalog';
import { nextFreeId } from '../../domain/commands';

/** Does the object carry a shape of its own, not the one its type gives it? */
export function hasOwnShape(catalog: Catalog, object: Equipment): boolean {
  if (object.outline === undefined) return false;
  const type = findObjectType(catalog, object.typeId);
  return type === null || !sameOutline(object.outline, typeOutline(type));
}

export function shapeTypeFrom(
  catalog: Catalog,
  object: Equipment,
  label: string,
): { catalog: Catalog; id: Id } | null {
  const source = findObjectType(catalog, object.typeId);
  const name = label.trim();
  if (source === null || object.outline === undefined || name === '') return null;
  const id = nextFreeId('ot_shape_', new Set(catalog.objectTypes.map((type) => type.id)));
  const type = {
    ...source,
    id,
    label: name,
    defaultSize_m: object.size_m,
    outline: object.outline,
    provenance: `Допущение команды: форма нарисована в редакторе на основе типа «${source.label}», размеры условные, не норматив Почты России.`,
  };
  return { catalog: { ...catalog, objectTypes: [...catalog.objectTypes, type] }, id };
}
