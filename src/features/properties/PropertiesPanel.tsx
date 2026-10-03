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
import { findObjectType, findZoneType } from '../../domain/catalog';
import { footprintArea, ringArea } from '../../domain/geometry';
import { formatArea, formatLength, formatNumber } from '../../domain/number-format';
import { hasOwnShape, shapeTypeFrom } from './shape-type';
import { ObjectPositionFields } from './ObjectPositionFields';

type Errors = Record<string, string>;

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
}: PropertiesPanelProps): React.JSX.Element {
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
  const selectionKey =
    session.selection === null ? '' : `${session.selection.kind}:${session.selection.id}`;
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
              // связи нет: правка имени тип не трогает. Переименовываем только
              // типовое имя (пустое, подпись прежнего типа, «Зона N» новой
              // зоны); введённое руками сохраняется (D-265).
              const typeId = event.target.value;
              const renamed = findZoneType(plan.catalog, typeId);
              const current = zone.name.trim();
              const generic = current === '' || current === type?.label || /^Зона \d+$/.test(current);
              setDraft((draft) => without(draft, 'name'));
              commit('typeId', {
                ...zone,
                typeId,
                name: renamed !== null && generic ? renamed.label : zone.name,
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
          : attributeFields(type.attributes, zone.attributes, (attributes) => ({ ...zone, attributes }))}
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
    return (
      <section ref={card} className="panel props" aria-label="Свойства" data-entity-id={object.id}>
        {groupMembers.length > 1 ? (
          <p className="props__hint" data-testid="props-group">
            Выбрано объектов: {groupMembers.length}, суммарно {formatArea(groupArea)}. Стрелки, Delete,
            Ctrl+C и перетаскивание действуют на всю группу; карточка показывает главный.
          </p>
        ) : null}

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

        {layerSelect(object.layerId, (layerId) => ({ ...object, layerId }))}

        <p className="props__line" data-testid="props-zone">
          Зона: {zoneName(plan, object.zoneId)}
        </p>

        {hasOwnShape(plan.catalog, object) ? (
          <div className="props__shape" data-testid="props-shape">
            <p className="props__line">
              Форма: своя, вершин — {object.outline?.length}. Двойной щелчок по объекту на плане — правка вершин.
            </p>
            <button
              type="button"
              className="files__button"
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
            Форма: как у типа. Двойной щелчок по объекту на плане — правка вершин.
          </p>
        )}
        {shapeSaved === null ? null : (
          <p className="props__line" role="status">
            {shapeSaved}
          </p>
        )}

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
            держать две правды об одной геометрии. */}
        <p className="props__hint">
          Длина {formatLength(length)}, от ({formatNumber(wall.from[0])}; {formatNumber(wall.from[1])}) до (
          {formatNumber(wall.to[0])}; {formatNumber(wall.to[1])}); концы тянутся на плане
        </p>
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
