/**
 * U06: карточка свойств выбранной зоны или объекта.
 *
 * Поля не перечислены в этом файле: имя, тип, размеры и угол — это поля модели,
 * а всё остальное приходит из справочника. Тип объекта объявляет свои атрибуты
 * и их типы, и карточка строит по ним поля. Новый атрибут в JSON — новое поле
 * здесь, без правки компонента; это прямой подпункт критерия расширяемости.
 *
 * Отказ команды показывается у того поля, которое его вызвало: команды
 * возвращают `path` вида `/height_m` или `/attributes/seats`, и карточка
 * раскладывает сообщения по этим путям. Введённый текст при отказе остаётся на
 * месте — иначе пользователь теряет то, что печатал, и не понимает почему.
 */

import { useState } from 'react';
import type {
  AttributeDef,
  Attributes,
  Equipment,
  Issue,
  Zone,
} from '../../contracts/model';
import type { PropertiesPanelProps } from '../../contracts/ui';
import { findObjectType, findZoneType } from '../../domain/catalog';

type Errors = Record<string, string>;

/** Раскладывает отказ команды по полям: `/attributes/seats` → `attributes.seats`. */
function errorsByField(issues: Issue[], fallback: string): Errors {
  const errors: Errors = {};
  for (const issue of issues) {
    const field = issue.path === undefined ? fallback : issue.path.replace(/^\//, '').replace(/\//g, '.');
    errors[field] = errors[field] === undefined ? issue.message : `${errors[field]} ${issue.message}`;
  }
  return errors;
}

/** Копия записи без одного ключа: принятая правка снимает свою пометку. */
function without(values: Record<string, string>, key: string): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter(([entry]) => entry !== key));
}

function parseNumber(input: string): number | null {
  if (input.trim() === '') return null;
  const value = Number(input.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

function attributeValue(attributes: Attributes, def: AttributeDef): string {
  const value = attributes[def.key];
  if (value === null || value === undefined) return '';
  return String(value);
}

export function PropertiesPanel({
  document: plan,
  session,
  onCommand,
}: PropertiesPanelProps): React.JSX.Element {
  const [errors, setErrors] = useState<Errors>({});
  const [draft, setDraft] = useState<Record<string, string>>({});

  const selection = session.selection;
  const zone = selection?.kind === 'zone' ? plan.zones.find((item) => item.id === selection.id) : undefined;
  const object =
    selection?.kind === 'object' ? plan.objects.find((item) => item.id === selection.id) : undefined;

  /**
   * Одна правка — одна команда. Принятая правка стирает свой черновик и свою
   * ошибку; отклонённая оставляет и то, и другое.
   */
  const commit = (field: string, entity: Zone | Equipment | null, raw?: string): void => {
    if (raw !== undefined) setDraft((current) => ({ ...current, [field]: raw }));

    if (entity === null) {
      setErrors((current) => ({ ...current, [field]: 'Нужно число.' }));
      return;
    }

    const result =
      'polygon' in entity
        ? onCommand({ type: 'zone.put', zone: entity })
        : onCommand({ type: 'object.put', object: entity });

    if (result.ok) {
      setErrors((current) => without(current, field));
      setDraft((current) => without(current, field));
      return;
    }
    setErrors((current) => ({ ...current, ...errorsByField(result.issues, field) }));
  };

  const shown = (field: string, value: string): string => draft[field] ?? value;

  const field = (
    name: string,
    label: string,
    input: React.JSX.Element,
    hint?: string,
  ): React.JSX.Element => (
    <label key={name} className="props__field">
      <span className="props__label">{label}</span>
      {input}
      {hint === undefined ? null : <span className="props__hint">{hint}</span>}
      {errors[name] === undefined ? null : (
        <span className="props__error" role="alert">
          {errors[name]}
        </span>
      )}
    </label>
  );

  const numberField = (
    name: string,
    label: string,
    value: number,
    apply: (next: number) => Zone | Equipment,
    step = 0.1,
  ): React.JSX.Element =>
    field(
      name,
      label,
      <input
        type="number"
        step={step}
        aria-label={label}
        value={shown(name, String(value))}
        onChange={(event) => {
          const parsed = parseNumber(event.target.value);
          commit(name, parsed === null ? null : apply(parsed), event.target.value);
        }}
      />,
    );

  /** Поля атрибутов строятся по справочнику, а не по списку в коде. */
  const attributeFields = (
    defs: AttributeDef[],
    attributes: Attributes,
    apply: (next: Attributes) => Zone | Equipment,
  ): React.JSX.Element[] =>
    defs.map((def) => {
      const name = `attributes.${def.key}`;
      const label = def.required ? `${def.label} *` : def.label;
      const set = (value: Attributes[string]): Zone | Equipment =>
        apply({ ...attributes, [def.key]: value });

      if (def.type === 'boolean') {
        return field(
          name,
          label,
          <input
            type="checkbox"
            aria-label={label}
            checked={attributes[def.key] === true}
            onChange={(event) => commit(name, set(event.target.checked))}
          />,
        );
      }
      if (def.type === 'number') {
        return field(
          name,
          label,
          <input
            type="number"
            aria-label={label}
            value={shown(name, attributeValue(attributes, def))}
            onChange={(event) => {
              const raw = event.target.value;
              // Пустое поле — очистка значения (null), а не ноль. Нечисло не
              // уходит в команду вовсе: NaN прошёл бы проверку типа атрибута.
              const parsed = parseNumber(raw);
              commit(name, raw.trim() === '' ? set(null) : parsed === null ? null : set(parsed), raw);
            }}
          />,
        );
      }
      return field(
        name,
        label,
        <input
          type="text"
          aria-label={label}
          value={shown(name, attributeValue(attributes, def))}
          onChange={(event) =>
            commit(name, set(event.target.value === '' ? null : event.target.value), event.target.value)
          }
        />,
      );
    });

  /** Атрибуты, которых нет в справочнике: показать, но не править вслепую. */
  const extraAttributes = (defs: AttributeDef[], attributes: Attributes): React.JSX.Element | null => {
    const known = new Set(defs.map((def) => def.key));
    const extra = Object.entries(attributes).filter(([key]) => !known.has(key));
    if (extra.length === 0) return null;
    return (
      <div className="props__extra">
        <p className="props__hint">Атрибуты вне справочника: правятся типом, не карточкой</p>
        <ul>
          {extra.map(([key, value]) => (
            <li key={key}>
              {key}: {value === null ? '—' : String(value)}
            </li>
          ))}
        </ul>
      </div>
    );
  };

  const layerSelect = (
    current: string,
    apply: (layerId: string) => Zone | Equipment,
  ): React.JSX.Element =>
    field(
      'layerId',
      'Слой',
      <select
        aria-label="Слой"
        value={current}
        onChange={(event) => commit('layerId', apply(event.target.value))}
      >
        {plan.layers
          .filter((layer) => layer.typeId === null)
          .map((layer) => (
            <option key={layer.id} value={layer.id}>
              {layer.name}
            </option>
          ))}
      </select>,
    );

  const identity = (id: string, kind: string): React.JSX.Element => (
    <p className="props__id">
      <span className="props__label">Идентификатор</span>
      <code data-testid="props-id">{id}</code>
      <span className="props__hint">{kind}; не меняется — по нему связаны инвентаризация и рекомендации</span>
    </p>
  );

  if (zone !== undefined) {
    const type = findZoneType(plan.catalog, zone.typeId);
    return (
      <section className="panel props" aria-label="Свойства">
        <h2 className="panel__title">Свойства зоны</h2>
        {identity(zone.id, 'зона')}

        {field(
          'name',
          'Название',
          <input
            type="text"
            aria-label="Название"
            value={shown('name', zone.name)}
            onChange={(event) => commit('name', { ...zone, name: event.target.value }, event.target.value)}
          />,
        )}

        {field(
          'typeId',
          'Тип зоны',
          <select
            aria-label="Тип зоны"
            value={zone.typeId}
            onChange={(event) => commit('typeId', { ...zone, typeId: event.target.value })}
          >
            {plan.catalog.zoneTypes.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>,
        )}

        {field(
          'parentId',
          'Внутри зоны',
          <select
            aria-label="Внутри зоны"
            value={zone.parentId ?? ''}
            onChange={(event) =>
              commit('parentId', {
                ...zone,
                parentId: event.target.value === '' ? null : event.target.value,
              })
            }
          >
            <option value="">— самостоятельная зона —</option>
            {plan.zones
              .filter((entry) => entry.id !== zone.id)
              .map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
          </select>,
        )}

        {layerSelect(zone.layerId, (layerId) => ({ ...zone, layerId }))}

        <p className="props__hint" data-testid="props-vertices">
          Вершин в контуре: {zone.polygon.length}; контур правится на плане
        </p>

        {type === null
          ? null
          : attributeFields(type.attributes, zone.attributes, (attributes) => ({ ...zone, attributes }))}
        {type === null ? null : extraAttributes(type.attributes, zone.attributes)}
      </section>
    );
  }

  if (object !== undefined) {
    const type = findObjectType(plan.catalog, object.typeId);
    return (
      <section className="panel props" aria-label="Свойства">
        <h2 className="panel__title">Свойства объекта</h2>
        {identity(object.id, 'объект')}

        {field(
          'label',
          'Название',
          <input
            type="text"
            aria-label="Название"
            value={shown('label', object.label)}
            onChange={(event) =>
              commit('label', { ...object, label: event.target.value }, event.target.value)
            }
          />,
        )}

        {field(
          'typeId',
          'Тип оборудования',
          <select
            aria-label="Тип оборудования"
            value={object.typeId}
            onChange={(event) => commit('typeId', { ...object, typeId: event.target.value })}
          >
            {plan.catalog.objectTypes.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>,
          type?.provenance,
        )}

        <div className="props__pair">
          {numberField('position.x', 'X, м', object.position[0], (next) => ({
            ...object,
            position: [next, object.position[1]],
          }))}
          {numberField('position.y', 'Y, м', object.position[1], (next) => ({
            ...object,
            position: [object.position[0], next],
          }))}
        </div>

        <div className="props__pair">
          {numberField('size_m.x', 'Ширина, м', object.size_m[0], (next) => ({
            ...object,
            size_m: [next, object.size_m[1]],
          }))}
          {numberField('size_m.y', 'Глубина, м', object.size_m[1], (next) => ({
            ...object,
            size_m: [object.size_m[0], next],
          }))}
        </div>

        <div className="props__pair">
          {numberField(
            'rotation_deg',
            'Поворот, °',
            object.rotation_deg,
            (next) => ({ ...object, rotation_deg: next }),
            1,
          )}
          {numberField('base_m', 'От пола, м', object.base_m, (next) => ({ ...object, base_m: next }))}
        </div>

        {numberField('height_m', 'Высота, м', object.height_m, (next) => ({
          ...object,
          height_m: next,
        }))}

        {layerSelect(object.layerId, (layerId) => ({ ...object, layerId }))}

        <p className="props__hint" data-testid="props-zone">
          Зона: {object.zoneId ?? 'вне зон'}; пересчитывается по геометрии
        </p>

        {type === null
          ? null
          : attributeFields(type.attributes, object.attributes, (attributes) => ({
              ...object,
              attributes,
            }))}
        {type === null ? null : extraAttributes(type.attributes, object.attributes)}
      </section>
    );
  }

  return (
    <section className="panel props" aria-label="Свойства">
      <h2 className="panel__title">Свойства</h2>
      <p className="panel__empty">Выберите зону или объект на плане</p>
    </section>
  );
}
