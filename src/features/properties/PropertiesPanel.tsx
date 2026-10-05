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

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type {
  AttributeDef,
  Attributes,
  Equipment,
  Issue,
  Opening,
  OpeningKind,
  PlanDocument,
  Wall,
  Zone,
} from '../../contracts/model';
import type { Command } from '../../contracts/commands';
import type { PropertiesPanelProps } from '../../contracts/ui';
import { attributeBoundsError, attributeRange, findObjectType, findZoneType } from '../../domain/catalog';
import { MAINTENANCE_DATE_KEY, maintenanceDateError } from '../../domain/validation';
import { footprintArea, ringArea } from '../../domain/geometry';
import { formatArea, formatLength, formatNumber } from '../../domain/number-format';
import { objectColorValue, type ObjectColorRepresentation } from '../../domain/object-color';
import { WALK_ATTRIBUTE_LABELS, WALK_MARK_KEY, WALK_MARK_LABELS, walkMarkOf } from '../../domain/inventory';
import { hasOwnShape, shapeTypeFrom } from './shape-type';
import { ObjectPositionFields } from './ObjectPositionFields';
import { groupAttributeCommand, mixedAttributeKeys, sharedAttributeDefs } from './group-attributes';
import { DISTRIBUTE_MIN, alignObjects, distributeObjects, putAll, type AlignEdge } from './group-align';

type Errors = Record<string, string>;

const ALIGN_BUTTONS: readonly (readonly [AlignEdge, string])[] = [
  ['left', 'По левому краю'],
  ['centerX', 'По центру'],
  ['right', 'По правому краю'],
  ['top', 'По верху'],
  ['centerY', 'По середине'],
  ['bottom', 'По низу'],
];

const noGesturePreview = () => null;
const subscribeToNothing = (): (() => void) => () => {};

/** Что карточка умеет править: по форме сущности понятно, какой командой. */
type Editable = Zone | Equipment | Wall | Opening;

/** Названия видов проёма: подписи для человека, значения — из контракта. */
const OPENING_KINDS: { kind: OpeningKind; label: string }[] = [
  { kind: 'entrance', label: 'Вход' },
  { kind: 'door', label: 'Дверь' },
  { kind: 'window', label: 'Окно' },
];

function commandFor(entity: Editable): Command {
  if ('polygon' in entity) return { type: 'zone.put', zone: entity };
  if ('wallId' in entity) return { type: 'opening.put', opening: entity };
  if ('thickness_m' in entity) return { type: 'wall.put', wall: entity };
  return { type: 'object.put', object: entity };
}

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

/**
 * The card names the zone as the plan does; an object outside every zone (or
 * pointing at a zone that is gone) says so. A blank name falls back to the id,
 * as in the inventory list: an empty «Зона: » tells nothing.
 */
function zoneName(plan: PlanDocument, zoneId: string | null): string {
  const zone = plan.zones.find((item) => item.id === zoneId);
  if (zone === undefined) return 'вне зон';
  return zone.name.trim() === '' ? zone.id : zone.name;
}

export function PropertiesPanel({
  document: plan,
  session,
  onCommand,
  gesturePreview,
  wallEditing = false,
  onWallEditingChange,
}: PropertiesPanelProps & {
  /** #167: the «Изменить перегородку» switch; without a handler it is not shown. */
  wallEditing?: boolean;
  onWallEditingChange?: (on: boolean) => void;
}): React.JSX.Element {
  const [errors, setErrors] = useState<Errors>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const liveGesture = useSyncExternalStore(
    gesturePreview?.subscribe ?? subscribeToNothing,
    gesturePreview?.getSnapshot ?? noGesturePreview,
    gesturePreview?.getSnapshot ?? noGesturePreview,
  );

  // A click in the inventory or in the findings list asks for this card: the
  // column may be scrolled far below it, so the card comes to the viewer.
  const card = useRef<HTMLElement>(null);
  const focusSequence = session.focus?.sequence ?? null;
  useEffect(() => {
    if (focusSequence === null) return;
    card.current?.scrollIntoView({ block: 'nearest' });
  }, [focusSequence]);

  // Drafts and errors belong to the card they were typed into: a refused name
  // for the plan must not show up in the name field of the zone clicked next.
  // A group card is a card of its own: the same primary with other members
  // must not inherit a draft typed for the previous group.
  const selectionKey =
    session.selection === null
      ? ''
      : `${session.selection.kind}:${session.selection.id}:${[...(session.selected ?? [])].sort().join(',')}`;
  const [draftsFor, setDraftsFor] = useState(selectionKey);
  const [shapeSaved, setShapeSaved] = useState<string | null>(null);
  if (draftsFor !== selectionKey) {
    setDraftsFor(selectionKey);
    setDraft({});
    setErrors({});
    setShapeSaved(null);
  }

  const selection = session.selection;
  const room = selection?.kind === 'room' ? plan.room : undefined;
  const zone = selection?.kind === 'zone' ? plan.zones.find((item) => item.id === selection.id) : undefined;
  const object =
    selection?.kind === 'object' ? plan.objects.find((item) => item.id === selection.id) : undefined;
  const wall = selection?.kind === 'wall' ? plan.walls.find((item) => item.id === selection.id) : undefined;
  const opening =
    selection?.kind === 'opening' ? plan.openings.find((item) => item.id === selection.id) : undefined;

  /**
   * Одна правка — одна команда. Принятая правка стирает свой черновик и свою
   * ошибку; отклонённая оставляет и то, и другое.
   */
  const commit = (field: string, entity: Editable | null, raw?: string): void =>
    commitCommand(field, entity === null ? null : commandFor(entity), raw);

  /** Та же дисциплина для правок, у которых нет сущности: план и помещение. */
  const commitCommand = (field: string, command: Command | null, raw?: string): void => {
    if (raw !== undefined) setDraft((current) => ({ ...current, [field]: raw }));

    if (command === null) {
      setErrors((current) => ({ ...current, [field]: 'Нужно число.' }));
      return;
    }

    const result = onCommand(command);

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
    apply: (next: number) => Editable,
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

  // No "conditional number" hint on any field — ever (D-281, participant's
  // explicit ban): synthetic data is disclosed in README and the presentation.

  /** Поля атрибутов строятся по справочнику, а не по списку в коде. */
  const attributeFields = (
    defs: AttributeDef[],
    attributes: Attributes,
    apply: (key: string, value: Attributes[string]) => Command,
    colorChoices: Map<string, ObjectColorRepresentation> = new Map(),
    mixed: ReadonlySet<string> = new Set(),
  ): React.JSX.Element[] =>
    defs.map((def) => {
      const name = `attributes.${def.key}`;
      const label = def.required ? `${def.label} *` : def.label;
      const set = (value: Attributes[string]): Command => apply(def.key, value);
      // Члены группы расходятся: поле пустое и говорит «разные», правка задаёт
      // одно значение всем.
      const isMixed = mixed.has(def.key);

      if (def.type === 'boolean') {
        return field(
          name,
          label,
          <input
            type="checkbox"
            aria-label={label}
            checked={!isMixed && attributes[def.key] === true}
            ref={(element) => {
              if (element !== null) element.indeterminate = isMixed;
            }}
            onChange={(event) => commitCommand(name, set(event.target.checked))}
          />,
          isMixed ? 'разные' : undefined,
        );
      }
      if (def.type === 'number') {
        const range = attributeRange(def);
        // Значение из файла может лежать вне границ (#138): поле называет это,
        // пока человек не исправит число.
        const stored = isMixed ? null : attributeBoundsError(def, attributes[def.key] ?? null);
        return field(
          name,
          label,
          <input
            type="number"
            aria-label={label}
            min={def.min}
            max={def.max}
            value={shown(name, isMixed ? '' : attributeValue(attributes, def))}
            placeholder={isMixed ? 'разные' : undefined}
            onChange={(event) => {
              const raw = event.target.value;
              // Пустое поле — очистка значения (null), а не ноль. Нечисло не
              // уходит в команду вовсе: NaN прошёл бы проверку типа атрибута.
              const parsed = parseNumber(raw);
              const outside = parsed === null ? null : attributeBoundsError(def, parsed);
              if (outside !== null) {
                // Число вне границ не применяется; черновик остаётся в поле.
                setDraft((current) => ({ ...current, [name]: raw }));
                setErrors((current) => ({ ...current, [name]: outside }));
                return;
              }
              commitCommand(name, raw.trim() === '' ? set(null) : parsed === null ? null : set(parsed), raw);
            }}
          />,
          stored ?? (range === null ? undefined : `Допустимо ${range}`),
        );
      }
      const choices = colorChoices.get(def.key);
      if (def.type === 'string' && choices !== undefined) {
        return field(
          name,
          label,
          <select
            aria-label={label}
            value={isMixed ? '' : objectColorValue(choices,attributes).value}
            onChange={(event) => commitCommand(name, set(event.target.value))}
          >
            {isMixed ? <option value="" disabled>разные</option> : null}
            {choices.values.map((choice) => (
              <option key={choice.value} value={choice.value}>{choice.label}</option>
            ))}
          </select>,
        );
      }
      return field(
        name,
        label,
        <input
          type="text"
          aria-label={label}
          value={shown(name, isMixed ? '' : attributeValue(attributes, def))}
          placeholder={isMixed ? 'разные' : undefined}
          onChange={(event) => {
            const raw = event.target.value;
            // Дата ТО: текст не дата — не применяется, черновик остаётся в поле (#151).
            const notDate = def.key === MAINTENANCE_DATE_KEY ? maintenanceDateError(raw) : null;
            if (notDate !== null) {
              setDraft((current) => ({ ...current, [name]: raw }));
              setErrors((current) => ({ ...current, [name]: notDate }));
              return;
            }
            commitCommand(name, set(raw === '' ? null : raw), raw);
          }}
        />,
      );
    });

  /** Атрибуты, которых нет в справочнике: показать, но не править вслепую. */
  const extraAttributes = (defs: AttributeDef[], attributes: Attributes): React.JSX.Element | null => {
    const known = new Set(defs.map((def) => def.key));
    // #124: marks of the inventory walk are read-only here and named in Russian.
    const walk = Object.entries(attributes).filter(([key]) => !known.has(key) && key in WALK_ATTRIBUTE_LABELS);
    const extra = Object.entries(attributes).filter(([key]) => !known.has(key) && !(key in WALK_ATTRIBUTE_LABELS));
    if (extra.length === 0 && walk.length === 0) return null;
    const walkMark = walkMarkOf({ attributes });
    return (
      <div className="props__extra">
        {walk.length === 0 ? null : (
          <ul data-testid="props-walk">
            {walk.map(([key, value]) => (
              <li key={key}>
                {WALK_ATTRIBUTE_LABELS[key]}:{' '}
                {key === WALK_MARK_KEY && walkMark !== null ? WALK_MARK_LABELS[walkMark] : value === null ? '—' : String(value)}
              </li>
            ))}
          </ul>
        )}
        {extra.length === 0 ? null : (
          <>
            <p className="props__hint">Атрибуты вне справочника: правятся типом, не карточкой</p>
            <ul>
              {extra.map(([key, value]) => (
                <li key={key}>
                  {key}: {value === null ? '—' : String(value)}
                </li>
              ))}
            </ul>
          </>
        )}
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

  if (room !== undefined) {
    // null — у контура площади нет: сам себя пересекает или схлопнут. Ворота
    // те же, что у панели площадей, поэтому две панели не спорят о числе;
    // карточка только выбирает слова (D-242).
    const area = ringArea(room.boundary);
    const areaHint =
      area === null
        ? `Контур пересекает сам себя: площадь по нему не считается. Вершин ${room.boundary.length}`
        : `Площадь по контуру ${formatArea(area)}, вершин ${room.boundary.length}`;
    return (
      <section ref={card} className="panel props" aria-label="Свойства" data-entity-id={room.id}>

        {/* Контур тянется на плане: числа здесь были бы второй правдой о геометрии. */}
        <p className="props__hint" data-testid="props-room-area">
          {areaHint}; контур тянется за вершины на плане
        </p>
      </section>
    );
  }

  if (zone !== undefined) {
    const type = findZoneType(plan.catalog, zone.typeId);
    return (
      <section ref={card} className="panel props" aria-label="Свойства" data-entity-id={zone.id}>

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
            onChange={(event) => {
              // Смена типа переименовывает зону в название типа — одной
              // командой, чтобы «Отменить» возвращало и тип, и имя. Обратной
              // связи нет: правка имени тип не трогает. Ручное название тоже
              // заменяется (D-265).
              const typeId = event.target.value;
              const renamed = findZoneType(plan.catalog, typeId);
              setDraft((draft) => without(draft, 'name'));
              commit('typeId', {
                ...zone,
                typeId,
                name: renamed === null ? zone.name : renamed.label,
              });
            }}
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
          : attributeFields(type.attributes, zone.attributes, (key, value) =>
              commandFor({ ...zone, attributes: { ...zone.attributes, [key]: value } }))}
        {type === null ? null : extraAttributes(type.attributes, zone.attributes)}
      </section>
    );
  }

  if (object !== undefined) {
    const type = findObjectType(plan.catalog, object.typeId);
    const position = liveGesture?.objectId === object.id ? liveGesture.position : object.position;
    // Группа (рамка, Shift+клик): карточка показывает главного, а счёт и площадь
    // — всей группы, чтобы было видно, на что подействуют стрелки и Delete.
    const groupMembers = plan.objects.filter((item) => session.selected?.has(item.id) ?? false);
    const groupArea = groupMembers.reduce((sum, item) => sum + footprintArea(item), 0);
    const colorChoices = new Map(plan.catalog.layerTypes.flatMap((layerType) =>
      layerType.representation.kind === 'object-color'
        ? [[layerType.representation.attribute, layerType.representation]] as const
        : []));

    // #30: группа правит общие атрибуты всех сразу — одна правка, одна
    // команда, один шаг «Отменить». Поля одного объекта здесь не показаны:
    // иначе часть полей меняла бы один объект, а часть — всех.
    if (groupMembers.length > 1) {
      const defs = sharedAttributeDefs(plan.catalog, groupMembers);
      const mixed = mixedAttributeKeys(groupMembers, defs, (attributes, def) => {
        const choices = colorChoices.get(def.key);
        if (def.type === 'string' && choices !== undefined) return objectColorValue(choices, attributes).value;
        if (def.type === 'boolean') return String(attributes[def.key] === true);
        return attributeValue(attributes, def);
      });
      const typeCounts = new Map<string, number>();
      for (const member of groupMembers) {
        const label = findObjectType(plan.catalog, member.typeId)?.label ?? member.typeId;
        typeCounts.set(label, (typeCounts.get(label) ?? 0) + 1);
      }
      return (
        <section ref={card} className="panel props" aria-label="Свойства" data-entity-id={object.id}>
          <p className="props__hint" data-testid="props-group">
            Выбрано объектов: {groupMembers.length}, суммарно {formatArea(groupArea)}. Стрелки, Delete,
            Ctrl+C и перетаскивание действуют на всю группу.
          </p>
          <p className="props__line" data-testid="props-group-types">
            {[...typeCounts].map(([label, count]) => `${label} — ${count}`).join('; ')}
          </p>
          {/* A refused batch is reported by the app («Правка отклонена»). */}
          <div className="props__align" role="group" aria-label="Выравнивание" data-testid="props-align">
            {ALIGN_BUTTONS.map(([edge, label]) => (
              <button
                key={edge}
                type="button"
                className="files__button"
                onClick={() => onCommand(putAll(alignObjects(groupMembers, edge)))}
              >
                {label}
              </button>
            ))}
            {([['x', 0], ['y', 1]] as const).map(([name, axis]) => (
              <button
                key={name}
                type="button"
                className="files__button"
                disabled={groupMembers.length < DISTRIBUTE_MIN}
                title={`Равные промежутки по ${name.toUpperCase()}, крайние остаются на месте; нужно не меньше ${DISTRIBUTE_MIN} объектов`}
                onClick={() => onCommand(putAll(distributeObjects(groupMembers, axis)))}
              >
                Равные промежутки по {name.toUpperCase()}
              </button>
            ))}
          </div>
          {defs.length === 0 ? (
            <p className="props__hint">
              У типов в группе нет общих атрибутов. Выберите объекты одного типа или один объект.
            </p>
          ) : (
            <>
              <p className="props__hint">
                Общие атрибуты. Правка меняет всю группу ({groupMembers.length}) одним шагом «Отменить».
              </p>
              {attributeFields(
                defs,
                object.attributes,
                (key, value) => groupAttributeCommand(groupMembers, key, value),
                colorChoices,
                mixed,
              )}
            </>
          )}
        </section>
      );
    }

    return (
      <section ref={card} className="panel props" aria-label="Свойства" data-entity-id={object.id}>

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

        <label className="props__line">
          <input type="checkbox" checked={object.locked === true}
            onChange={(event) => commit('locked', { ...object, locked: event.target.checked })} />
          {' '}Закрепить объект
        </label>
        {object.locked !== true ? null : (
          <p className="props__hint">Объект закреплён: движение, поворот, размер и удаление защищены. Снимите замок, чтобы изменить геометрию.</p>
        )}
        <fieldset className="props__geometry" disabled={object.locked === true}>
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

        <ObjectPositionFields key={`${object.id}:${position[0]}:${position[1]}`}
          object={object} position={position} onCommand={onCommand}
          moving={liveGesture?.objectId === object.id} />

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

        </fieldset>

        {layerSelect(object.layerId, (layerId) => ({ ...object, layerId }))}

        <p className="props__line" data-testid="props-zone">
          Зона: {zoneName(plan, object.zoneId)}
        </p>

        {hasOwnShape(plan.catalog, object) ? (
          <div className="props__shape" data-testid="props-shape">
            <p className="props__line">
              Форма: своя, вершин — {object.outline?.length}. {object.locked === true ? 'Для правки вершин снимите замок.' : 'Включите «Изменить форму» под карточкой, затем двойной щелчок по объекту на плане — правка вершин.'}
            </p>
            <button
              type="button"
              className="files__button"
              disabled={object.locked === true}
              onClick={() => {
                const rest = { ...object };
                delete rest.outline;
                commitCommand('shape', { type: 'object.put', object: rest });
              }}
            >
              Сбросить форму к типу
            </button>
            {field(
              'shape.name',
              'Название нового типа',
              <input
                type="text"
                aria-label="Название нового типа"
                value={shown('shape.name', '')}
                onChange={(event) => setDraft((current) => ({ ...current, 'shape.name': event.target.value }))}
              />,
            )}
            <button
              type="button"
              className="files__button"
              onClick={() => {
                const name = shown('shape.name', '');
                const created = shapeTypeFrom(plan.catalog, object, name);
                if (created === null) {
                  setErrors((current) => ({ ...current, 'shape.name': 'Введите название типа.' }));
                  return;
                }
                if (onCommand({ type: 'catalog.replace', catalog: created.catalog }).ok) {
                  setShapeSaved(`Тип «${name.trim()}» добавлен в библиотеку.`);
                  setDraft((current) => without(current, 'shape.name'));
                  setErrors((current) => without(current, 'shape.name'));
                } else {
                  setErrors((current) => ({ ...current, 'shape.name': 'Справочник не принял новый тип.' }));
                }
              }}
            >
              Сохранить форму как новый тип
            </button>
          </div>
        ) : (
          <p className="props__hint" data-testid="props-shape">
            Форма: как у типа. {object.locked === true ? 'Для правки вершин снимите замок.' : 'Включите «Изменить форму» под карточкой, затем двойной щелчок по объекту на плане — правка вершин.'}
          </p>
        )}
        {shapeSaved === null ? null : (
          <p className="props__line" role="status">
            {shapeSaved}
          </p>
        )}

        {type === null
          ? null
          : attributeFields(
              type.attributes,
              object.attributes,
              (key, value) => commandFor({ ...object, attributes: { ...object.attributes, [key]: value } }),
              colorChoices,
            )}
        {type === null ? null : extraAttributes(type.attributes, object.attributes)}
      </section>
    );
  }

  if (wall !== undefined) {
    const openings = plan.openings.filter((entry) => entry.wallId === wall.id);
    const length = Math.hypot(wall.to[0] - wall.from[0], wall.to[1] - wall.from[1]);
    return (
      <section ref={card} className="panel props" aria-label="Свойства" data-entity-id={wall.id}>

        <div className="props__pair">
          {numberField('thickness_m', 'Толщина, м', wall.thickness_m, (next) => ({
            ...wall,
            thickness_m: next,
          }))}
          {numberField('height_m', 'Высота, м', wall.height_m, (next) => ({
            ...wall,
            height_m: next,
          }))}
        </div>

        {/* Концы стены тянутся на плане: править их числами здесь значило бы
            держать две правды об одной геометрии. Ручки концов есть только при
            включённом переключателе (#167): выбор стены её не меняет. */}
        <p className="props__hint">
          Длина {formatLength(length)}, от ({formatNumber(wall.from[0])}; {formatNumber(wall.from[1])}) до (
          {formatNumber(wall.to[0])}; {formatNumber(wall.to[1])})
        </p>
        {onWallEditingChange === undefined ? null : (
          <label
            className="props__line"
            title="Без галочки перегородку можно только выбрать. С галочкой на её концах появляются ручки. Снимается при другом выборе, смене инструмента и по Esc."
          >
            <input
              type="checkbox"
              checked={wallEditing}
              onChange={(event) => onWallEditingChange(event.target.checked)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && wallEditing) onWallEditingChange(false);
              }}
            />
            {' '}Изменить перегородку
          </label>
        )}
        {onWallEditingChange === undefined ? null : (
          <p className="props__hint">
            {wallEditing
              ? 'Тяните ручку на конце перегородки; Alt — без привязки. Ctrl+Z отменяет правку.'
              : 'Включите «Изменить перегородку», чтобы тянуть её концы на плане.'}
          </p>
        )}
        <p className="props__hint">
          {openings.length === 0
            ? 'Проёмов нет; инструмент «Проём» ставит их кликом по стене'
            : `Проёмов на стене: ${openings.length}; удаление стены уносит их вместе с ней`}
        </p>
      </section>
    );
  }

  if (opening !== undefined) {
    const host = plan.walls.find((entry) => entry.id === opening.wallId);
    const hostLength =
      host === undefined ? null : Math.hypot(host.to[0] - host.from[0], host.to[1] - host.from[1]);
    return (
      <section ref={card} className="panel props" aria-label="Свойства" data-entity-id={opening.id}>

        {field(
          'kind',
          'Вид',
          <select
            aria-label="Вид"
            value={opening.kind}
            onChange={(event) =>
              commit('kind', { ...opening, kind: event.target.value as OpeningKind })
            }
          >
            {OPENING_KINDS.map((entry) => (
              <option key={entry.kind} value={entry.kind}>
                {entry.label}
              </option>
            ))}
          </select>,
          'Вход участвует в правиле «терминал не далее 3 м от входа»',
        )}

        <div className="props__pair">
          {numberField('offset_m', 'Отступ от начала, м', opening.offset_m, (next) => ({
            ...opening,
            offset_m: next,
          }))}
          {numberField('width_m', 'Ширина, м', opening.width_m, (next) => ({
            ...opening,
            width_m: next,
          }))}
        </div>

        <div className="props__pair">
          {numberField('sill_m', 'От пола, м', opening.sill_m, (next) => ({
            ...opening,
            sill_m: next,
          }))}
          {numberField('height_m', 'Высота, м', opening.height_m, (next) => ({
            ...opening,
            height_m: next,
          }))}
        </div>

        <p className="props__hint" data-testid="props-wall">
          {host === undefined
            ? `Стена «${opening.wallId}» не найдена: проём требует пересчёта`
            : `На перегородке «${host.id}» длиной ${hostLength === null ? '—' : formatLength(hostLength)}`}
        </p>
      </section>
    );
  }

  return (
    <section ref={card} className="panel props" aria-label="Свойства">
      <p className="panel__empty">Выберите помещение, зону, объект, перегородку или проём на плане</p>
    </section>
  );
}
