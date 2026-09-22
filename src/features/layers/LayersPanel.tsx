/**
 * U05: панель слоёв.
 *
 * Два разных дела в одном списке, и это намеренно. Обычный слой — группа
 * содержимого: имя, порядок, видимость, замок, удаление с переносом объектов.
 * Информационный слой — представление поверх всего плана: он ничего не
 * содержит, и вместо содержимого у него таблица значений, которые он рисует.
 *
 * Значения вводит человек — это условные числа для планирования, а не
 * измерение; происхождение чисел описано в README и раскрывается на защите,
 * а не подписью в интерфейсе. Без такой таблицы слой был бы мёртвым —
 * атрибуты зон в файле пока некому заполнить.
 */

import { useState } from 'react';
import type { Equipment, Id, Layer, LayerType, Zone } from '../../contracts/model';
import type { LayersPanelProps } from '../../contracts/ui';
import { findLayerType } from '../../domain/catalog';
import { takenIds } from '../../domain/commands';
import { editableContentLayer } from '../../domain/content-layer';
import { OBJECT_MOUNTS, countByMount, type ObjectMount } from '../../domain/object-mount';
import { legendOf } from './legend';

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

type IconName = 'lock' | 'unlock' | 'up' | 'down' | 'delete';

/** Strokes on a 24-unit grid; `currentColor` so hover and disabled states recolour them. */
const ICON_PATHS: Record<IconName, string> = {
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z',
  unlock: 'M7 11V8a5 5 0 0 1 9.6-2M5 11h14v10H5z',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  delete: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
};

/**
 * Inline SVG instead of emoji and arrow characters: the same drawing in every
 * font, and the button's name comes from its `aria-label`, not from the glyph.
 */
function Icon({ name }: { name: IconName }): React.JSX.Element {
  return (
    <svg
      className="layers__icon"
      data-icon={name}
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

/**
 * D-275: floor and ceiling objects of the base layer, each with its own
 * visibility. View state held by the app, never a command: hiding a group
 * writes nothing to the plan and leaves undo alone.
 */
export type ObjectMountsView = {
  layerId: Id;
  hidden: ReadonlySet<ObjectMount>;
  onToggle: (mount: ObjectMount) => void;
};

const MOUNT_LABELS: Record<ObjectMount, string> = {
  floor: 'Напольные объекты',
  ceiling: 'Потолочные объекты',
};

export function LayersPanel({
  document: plan,
  session,
  onCommand,
  onSelect,
  objectMounts,
}: LayersPanelProps & { objectMounts?: ObjectMountsView }): React.JSX.Element {
  const [newTypeId, setNewTypeId] = useState<string>('');

  const ordered = plan.layers.slice().sort((a, b) => a.order - b.order);
  const used = new Set(plan.layers.map((layer) => layer.typeId));
  const available = plan.catalog.layerTypes.filter((type) => !used.has(type.id));

  const put = (layer: Layer): void => void onCommand({ type: 'layer.put', layer });

  const add = (): void => {
    const type = plan.catalog.layerTypes.find((entry) => entry.id === newTypeId) ?? null;
    const suffix = Date.now().toString(36);
    // A layer removed this session retired its id (D-019): adding the same
    // type again takes the next free number instead of a refused put.
    const taken = takenIds(plan, session.retired);
    const freeId = (base: string): string => {
      if (!taken.has(base)) return base;
      for (let index = 2; ; index += 1) {
        if (!taken.has(`${base}_${index}`)) return `${base}_${index}`;
      }
    };
    put({
      id: type === null ? freeId(`l_${suffix}`) : freeId(`l_${type.id}`),
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
    return editableContentLayer(ordered, layer.id);
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

  const legendView = (layer: Layer, type: LayerType): React.JSX.Element | null => {
    const legend = legendOf(type);
    if (legend.kind === 'none') return null;
    return (
      <div className="layers__legend" role="group" aria-label={`Легенда слоя ${layer.name}`}>
        {legend.kind === 'scale' ? (
          <>
            <div
              className="layers__scale"
              style={{ background: `linear-gradient(to right, ${legend.from}, ${legend.to})` }}
            />
            <div className="layers__scale-ticks">
              <span>{legend.low}</span>
              <span>{legend.high}</span>
            </div>
            <p className="layers__legend-text">{legend.threshold}</p>
          </>
        ) : (
          <p className="layers__legend-text">
            <span className="layers__swatch" style={{ background: legend.color }} />
            {legend.text}
          </p>
        )}
      </div>
    );
  };

  /**
   * One short line under the name. An informational layer's legend (shown
   * once it is visible) and its collapsed «Что показывает слой» already say
   * what it draws, so it needs no extra line here; an ordinary layer's line
   * is its content count.
   */
  const describe = (layer: Layer, type: LayerType | null): string | null => {
    if (type !== null) return null;
    const { zones, objects } = contentOf(layer);
    return `обычный слой · зон ${zones.length}, объектов ${objects.length}`;
  };

  const mountsView = (layer: Layer): React.JSX.Element | null => {
    if (objectMounts === undefined || objectMounts.layerId !== layer.id) return null;
    const counts = countByMount(plan.objects, layer.id);
    return (
      <ul className="layers__mounts" aria-label={`Группы объектов слоя ${layer.name}`}>
        {OBJECT_MOUNTS.map((mount) => {
          const label = MOUNT_LABELS[mount];
          const shown = !objectMounts.hidden.has(mount);
          return (
            <li key={mount}>
              {/* The same pressed button as the layer's own toggle. With the
                  layer hidden the group is hidden anyway: the toggle keeps its
                  own state but is disabled and says why. */}
              <button
                type="button"
                className="layers__visible"
                aria-label={`Показывать: ${label.toLowerCase()}`}
                title={
                  !layer.visible
                    ? `Слой «${layer.name}» скрыт — сначала покажите слой`
                    : shown
                      ? 'Группа показана — скрыть'
                      : 'Группа скрыта — показать'
                }
                aria-pressed={shown}
                disabled={!layer.visible}
                onClick={() => objectMounts.onToggle(mount)}
              >
                <span className="layers__check" aria-hidden="true">
                  {shown ? '✓' : ''}
                </span>
                {label} ({counts[mount]})
              </button>
            </li>
          );
        })}
      </ul>
    );
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
        {/* The heading already says «Слои»; a short caption leaves the select room for «Обычный слой». */}
        <button type="button" className="files__button" aria-label="Добавить слой" onClick={add}>
          Добавить
        </button>
      </div>

      <ul className="layers__list">
        {ordered.map((layer) => {
          const type = findLayerType(plan.catalog, layer.typeId);
          const target = moveTargetFor(layer);
          const selected = session.selection?.kind === 'layer' && session.selection.id === layer.id;
          const meta = describe(layer, type);

          return (
            <li key={layer.id} className={selected ? 'layers__item is-selected' : 'layers__item'}>
              <div className="layers__row">
                <input
                  className="layers__name"
                  aria-label={`Имя слоя ${layer.name}`}
                  title={layer.name}
                  value={layer.name}
                  onFocus={() => onSelect({ kind: 'layer', id: layer.id })}
                  onChange={(event) => put({ ...layer, name: event.target.value })}
                />
                {/* A pressed button, not an input: other specs and the 3D view
                    address it by this role; it looks and reads like a checkbox. */}
                <button
                  type="button"
                  className="layers__visible"
                  aria-label={`Показывать слой ${layer.name}`}
                  title={layer.visible ? 'Слой показан — скрыть' : 'Слой скрыт — показать'}
                  aria-pressed={layer.visible}
                  onClick={() => put({ ...layer, visible: !layer.visible })}
                >
                  <span className="layers__check" aria-hidden="true">
                    {layer.visible ? '✓' : ''}
                  </span>
                  Показывать
                </button>
                <button
                  type="button"
                  className="layers__toggle"
                  aria-label={`Запереть слой ${layer.name}`}
                  title={layer.locked ? 'Слой заперт, правки запрещены — отпереть' : 'Слой открыт для правок — запереть'}
                  aria-pressed={layer.locked}
                  onClick={() => put({ ...layer, locked: !layer.locked })}
                >
                  <Icon name={layer.locked ? 'lock' : 'unlock'} />
                </button>
                <button
                  type="button"
                  className="layers__toggle"
                  aria-label={`Поднять слой ${layer.name}`}
                  title="Поднять слой"
                  onClick={() => move(layer, -1)}
                >
                  <Icon name="up" />
                </button>
                <button
                  type="button"
                  className="layers__toggle"
                  aria-label={`Опустить слой ${layer.name}`}
                  title="Опустить слой"
                  onClick={() => move(layer, 1)}
                >
                  <Icon name="down" />
                </button>
                <button
                  type="button"
                  className="layers__toggle"
                  aria-label={`Удалить слой ${layer.name}`}
                  title={
                    target === undefined
                      ? 'Последний слой удалить нельзя'
                      : `Удалить; содержимое уедет в слой «${target.name}»`
                  }
                  disabled={target === undefined}
                  onClick={() =>
                    target === undefined
                      ? undefined
                      : onCommand({ type: 'layer.delete', id: layer.id, moveTo: target.id })
                  }
                >
                  <Icon name="delete" />
                </button>
              </div>

              {meta === null ? null : <p className="layers__meta">{meta}</p>}
              {mountsView(layer)}

              {type === null ? null : (
                <>
                  {layer.visible ? legendView(layer, type) : null}
                  <details className="layers__about">
                    <summary>Что показывает слой</summary>
                    <p className="layers__note">
                      Информационный слой: рисует поверх всего плана, содержимого не хранит.{' '}
                      {type.note}
                    </p>
                  </details>
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
