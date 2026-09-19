/**
 * U05: панель слоёв.
 *
 * Два разных дела в одном списке, и это намеренно. Обычный слой — группа
 * содержимого: имя, порядок, видимость, замок, удаление с переносом объектов.
 * Информационный слой — представление поверх всего плана: он ничего не
 * содержит, и вместо содержимого у него таблица значений, которые он рисует.
 *
 * Значения вводит человек, и рядом с ними стоит подпись из справочника: это
 * синтетические числа для планирования, а не измерение. Без такой таблицы
 * слой был бы мёртвым — атрибуты зон в файле пока некому заполнить.
 */

import { useState } from 'react';
import type { Equipment, Layer, LayerType, Zone } from '../../contracts/model';
import type { LayersPanelProps } from '../../contracts/ui';
import { findLayerType } from '../../domain/catalog';

/** Пустое поле — это «значения нет», а не ноль. */
function parseValue(input: string): number | null {
  if (input.trim() === '') return null;
  const value = Number(input.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

function valueOf(
  attributes: Record<string, string | number | boolean | null>,
  key: string,
): string {
  const value = attributes[key];
  return typeof value === 'number' ? String(value) : '';
}

export function LayersPanel({
  document: plan,
  session,
  onCommand,
  onSelect,
}: LayersPanelProps): React.JSX.Element {
  const [newTypeId, setNewTypeId] = useState<string>('');

  const ordered = plan.layers.slice().sort((a, b) => a.order - b.order);
  const used = new Set(plan.layers.map((layer) => layer.typeId));
  const available = plan.catalog.layerTypes.filter((type) => !used.has(type.id));

  const put = (layer: Layer): void => void onCommand({ type: 'layer.put', layer });

  const add = (): void => {
    const type = plan.catalog.layerTypes.find((entry) => entry.id === newTypeId) ?? null;
    const suffix = Date.now().toString(36);
    put({
      id: type === null ? `l_${suffix}` : `l_${type.id}`,
      name: type === null ? `Слой ${plan.layers.length + 1}` : type.label,
      visible: true,
      locked: false,
      order: Math.max(...plan.layers.map((layer) => layer.order)) + 1,
      typeId: type?.id ?? null,
    });
    setNewTypeId('');
  };

  const move = (layer: Layer, direction: -1 | 1): void => {
    const index = ordered.findIndex((entry) => entry.id === layer.id);
    const neighbour = ordered[index + direction];
    if (neighbour === undefined) return;
    // Две команды: порядок — это поле каждого слоя, обмен затрагивает оба.
    put({ ...neighbour, order: layer.order });
    put({ ...layer, order: neighbour.order });
  };

  /**
   * Куда уедет содержимое удаляемого слоя. Сначала обычный незапертый слой:
   * информационный слой ничего не содержит, и складывать в него зоны нельзя.
   */
  const moveTargetFor = (layer: Layer): Layer | undefined => {
    const free = ordered.filter((entry) => entry.id !== layer.id && !entry.locked);
    return free.find((entry) => entry.typeId === null) ?? free[0];
  };

  const contentOf = (layer: Layer): { zones: Zone[]; objects: Equipment[] } => ({
    zones: plan.zones.filter((zone) => zone.layerId === layer.id),
    objects: plan.objects.filter((object) => object.layerId === layer.id),
  });

  const setZoneValue = (zone: Zone, key: string, input: string): void => {
    onCommand({
      type: 'zone.put',
      zone: { ...zone, attributes: { ...zone.attributes, [key]: parseValue(input) } },
    });
  };

  const setObjectValue = (object: Equipment, key: string, input: string): void => {
    onCommand({
      type: 'object.put',
      object: { ...object, attributes: { ...object.attributes, [key]: parseValue(input) } },
    });
  };

  const dataTable = (type: LayerType): React.JSX.Element | null => {
    const representation = type.representation;
    if (representation.kind === 'objects') return null;

    if (representation.kind === 'object-field') {
      const types = new Set(representation.objectTypeIds);
      const objects = plan.objects.filter((object) => types.has(object.typeId));
      if (objects.length === 0) {
        return <p className="panel__empty">На плане нет объектов этого слоя</p>;
      }
      return (
        <table className="layers__data">
          <tbody>
            {objects.map((object) => (
              <tr key={object.id}>
                <th scope="row">
                  <button
                    type="button"
                    className="table__link"
                    onClick={() => onSelect({ kind: 'object', id: object.id })}
                  >
                    {object.label}
                  </button>
                </th>
                <td>
                  <input
                    type="number"
                    aria-label={`Угол обзора, ${object.label} (${object.id})`}
                    value={valueOf(object.attributes, representation.angleAttribute)}
                    placeholder={String(representation.angle_deg)}
                    onChange={(event) =>
                      setObjectValue(object, representation.angleAttribute, event.target.value)
                    }
                  />
                </td>
                <td>
                  <input
                    type="number"
                    aria-label={`Дальность обзора, ${object.label} (${object.id})`}
                    value={valueOf(object.attributes, representation.rangeAttribute)}
                    placeholder={String(representation.range_m)}
                    onChange={(event) =>
                      setObjectValue(object, representation.rangeAttribute, event.target.value)
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    if (plan.zones.length === 0) {
      return <p className="panel__empty">Нарисуйте зону, чтобы задать значения</p>;
    }
    return (
      <table className="layers__data">
        <tbody>
          {plan.zones.map((zone) => (
            <tr key={zone.id}>
              <th scope="row">
                <button
                  type="button"
                  className="table__link"
                  onClick={() => onSelect({ kind: 'zone', id: zone.id })}
                >
                  {zone.name}
                </button>
              </th>
              <td>
                <input
                  type="number"
                  aria-label={`${type.label}, ${zone.name} (${zone.id})`}
                  value={valueOf(zone.attributes, representation.attribute)}
                  onChange={(event) =>
                    setZoneValue(zone, representation.attribute, event.target.value)
                  }
                />
              </td>
              <td className="layers__unit">{representation.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  const describe = (layer: Layer, type: LayerType | null): string => {
    if (type !== null) return 'информационный слой: рисует поверх всего плана';
    const { zones, objects } = contentOf(layer);
    return `обычный слой · зон ${zones.length}, объектов ${objects.length}`;
  };

  return (
    <section className="panel layers" aria-label="Слои">
      <h2 className="panel__title">Слои</h2>

      <div className="layers__add">
        <select
          aria-label="Тип нового слоя"
          value={newTypeId}
          onChange={(event) => setNewTypeId(event.target.value)}
        >
          <option value="">Обычный слой</option>
          {available.map((type) => (
            <option key={type.id} value={type.id}>
              {type.label}
            </option>
          ))}
        </select>
        <button type="button" className="files__button" onClick={add}>
          Добавить слой
        </button>
      </div>

      <ul className="layers__list">
        {ordered.map((layer) => {
          const type = findLayerType(plan.catalog, layer.typeId);
          const target = moveTargetFor(layer);
          const selected = session.selection?.kind === 'layer' && session.selection.id === layer.id;

          return (
            <li key={layer.id} className={selected ? 'layers__item is-selected' : 'layers__item'}>
              <div className="layers__row">
                <input
                  className="layers__name"
                  aria-label={`Имя слоя ${layer.name}`}
                  value={layer.name}
                  onFocus={() => onSelect({ kind: 'layer', id: layer.id })}
                  onChange={(event) => put({ ...layer, name: event.target.value })}
                />
                <button
                  type="button"
                  className="layers__toggle"
                  aria-label={`Показывать слой ${layer.name}`}
                  title={layer.visible ? 'Слой показан — скрыть' : 'Слой скрыт — показать'}
                  aria-pressed={layer.visible}
                  onClick={() => put({ ...layer, visible: !layer.visible })}
                >
                  {layer.visible ? '👁' : '—'}
                </button>
                <button
                  type="button"
                  className="layers__toggle"
                  aria-label={`Запереть слой ${layer.name}`}
                  title={layer.locked ? 'Слой заперт, правки запрещены — отпереть' : 'Слой открыт для правок — запереть'}
                  aria-pressed={layer.locked}
                  onClick={() => put({ ...layer, locked: !layer.locked })}
                >
                  {layer.locked ? '🔒' : '🔓'}
                </button>
                <button
                  type="button"
                  className="layers__toggle"
                  aria-label={`Поднять слой ${layer.name}`}
                  title="Поднять слой"
                  onClick={() => move(layer, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="layers__toggle"
                  aria-label={`Опустить слой ${layer.name}`}
                  title="Опустить слой"
                  onClick={() => move(layer, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="layers__toggle"
                  aria-label={`Удалить слой ${layer.name}`}
                  title={
                    target === undefined
                      ? 'Последний слой удалить нельзя'
                      : `Содержимое уедет в слой «${target.name}»`
                  }
                  disabled={target === undefined}
                  onClick={() =>
                    target === undefined
                      ? undefined
                      : onCommand({ type: 'layer.delete', id: layer.id, moveTo: target.id })
                  }
                >
                  ✕
                </button>
              </div>

              <p className="layers__meta">{describe(layer, type)}</p>

              {type === null ? null : (
                <>
                  <p className="layers__note">{type.note}</p>
                  {layer.visible ? dataTable(type) : null}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
