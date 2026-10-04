/**
 * Справочник в интерфейсе: типы оборудования, их атрибуты, правила
 * комплектования — то, что специалист по инвентаризации раньше мог поменять
 * только правкой JSON (находка operator №5).
 *
 * Панель ничего не решает сама: собирает новый каталог функциями из
 * `catalog-edit.ts` и отдаёт одной командой `catalog.replace`. Отказ команды —
 * тип используется объектами, обязательный атрибут без умолчания — показывается
 * здесь же, а не тонет в общей полосе ошибок. Всё добавленное подписано как
 * допущение команды и уезжает в файл вместе с планом.
 */

import { useState } from 'react';
import type { Catalog, Id, ObjectSymbol, PlanDocument } from '../../contracts/model';
import type { CommandSink } from '../../contracts/ui';
import {
  addAttribute,
  addCountRule,
  addObjectType,
  attributeKeyFromLabel,
  addZoneType,
  removeAttribute,
  removeObjectType,
  removeZoneType,
  layersReading,
  removeRule,
  type NewAttribute,
} from './catalog-edit';

/** D-350: the catalog is set up in the «Настройки» window, one section at a time. */
export type CatalogSection = 'objects' | 'zones' | 'rules';

export type CatalogPanelProps = {
  document: PlanDocument;
  onCommand: CommandSink;
  section: CatalogSection;
};

const SECTION_TITLES: Record<CatalogSection, string> = {
  objects: 'Типы оборудования',
  zones: 'Типы зон',
  rules: 'Правила комплектования',
};

const SYMBOLS: { value: ObjectSymbol; label: string }[] = [
  { value: 'rect', label: 'прямоугольник' },
  { value: 'circle', label: 'круг' },
  { value: 'triangle', label: 'треугольник' },
];

/** Metres typed by a person: a comma is a decimal point; anything else is refused, not replaced. */
function metres(value: string): number | null {
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** A count bound: empty means no bound; otherwise a whole number >= 0. */
function bound(value: string): number | null | undefined {
  const raw = value.trim();
  if (raw === '') return null;
  const parsed = Number(raw.replace(',', '.'));
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

const ATTRIBUTE_KEY = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const BOOLEAN_WORDS: Record<string, boolean> = { да: true, true: true, нет: false, false: false };

/**
 * Same limit and the same wording as «Инвентаризация»: three types, three
 * zone types, three rules, then «Показать все (N)»/«Свернуть» (user request
 * 22.09). The form to add a new item is never inside the collapsed part, and
 * adding one expands its list — the item just created is what the person
 * came here to see.
 */
const COLLAPSE_LIMIT = 3;

/** First `limit` items, or all of them once expanded — no items lost, only hidden. */
function headCount<T>(items: readonly T[], expanded: boolean, limit: number): number {
  return expanded || items.length <= limit ? items.length : limit;
}

export function CatalogPanel({ document: plan, onCommand, section }: CatalogPanelProps): React.JSX.Element {
  const catalog = plan.catalog;
  const [error, setError] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<Id | null>(null);

  // Свёрнуто по умолчанию, как «Объекты по типам» в инвентаризации; состояние
  // экрана, а не документа. Добавление раскрывает список — только что
  // созданный тип/правило всегда видно, а не только числится в счётчике.
  const [typesExpanded, setTypesExpanded] = useState(false);
  const [zoneTypesExpanded, setZoneTypesExpanded] = useState(false);
  const [rulesExpanded, setRulesExpanded] = useState(false);

  const [typeLabel, setTypeLabel] = useState('');
  const [typeCategory, setTypeCategory] = useState('');
  const [typeWidth, setTypeWidth] = useState('0.6');
  const [typeDepth, setTypeDepth] = useState('0.6');
  const [typeHeight, setTypeHeight] = useState('0.8');
  const [typeSymbol, setTypeSymbol] = useState<ObjectSymbol>('rect');
  const [typeColor, setTypeColor] = useState('#4C6EF5');
  const [typePhysical, setTypePhysical] = useState(true);

  const [zoneLabel, setZoneLabel] = useState('');
  const [zoneColor, setZoneColor] = useState('#D0EBFF');

  const [attrKey, setAttrKey] = useState('');
  const [attrKeyOpen, setAttrKeyOpen] = useState(false);
  const [attrLabel, setAttrLabel] = useState('');
  const [attrType, setAttrType] = useState<NewAttribute['type']>('string');
  const [attrRequired, setAttrRequired] = useState(false);
  const [attrDefault, setAttrDefault] = useState('');

  const [ruleZone, setRuleZone] = useState('');
  const [ruleObject, setRuleObject] = useState('');
  const [ruleMin, setRuleMin] = useState('1');
  const [ruleMax, setRuleMax] = useState('');
  const [ruleWhy, setRuleWhy] = useState('');

  const apply = (next: Catalog): boolean => {
    const result = onCommand({ type: 'catalog.replace', catalog: next });
    if (result.ok) {
      setError(null);
      return true;
    }
    setError(result.issues.map((issue) => issue.message).join(' '));
    return false;
  };

  const categories = [...new Set(catalog.objectTypes.map((t) => t.category))];
  // The attribute form serves both kinds of type: `addAttribute` finds the id
  // among object types and zone types alike. Each section edits its own kind.
  const chosenObject = section === 'objects' ? (catalog.objectTypes.find((t) => t.id === selectedType) ?? null) : null;
  const chosenZone = section === 'zones' ? (catalog.zoneTypes.find((t) => t.id === selectedType) ?? null) : null;
  const chosen = chosenObject ?? chosenZone;
  const usedBy = (typeId: Id): number => plan.objects.filter((o) => o.typeId === typeId).length;
  const zonesOf = (typeId: Id): number => plan.zones.filter((z) => z.typeId === typeId).length;

  const submitZoneType = (): void => {
    const label = zoneLabel.trim();
    if (label === '') {
      setError('У нового типа зоны должно быть название.');
      return;
    }
    const twin = catalog.zoneTypes.find((t) => t.label.trim().toLowerCase() === label.toLowerCase());
    if (twin !== undefined) {
      setError(`Тип зоны «${twin.label}» уже есть в справочнике (${twin.id}); дайте новому другое название.`);
      return;
    }
    const { catalog: next, id } = addZoneType(catalog, { label, color: zoneColor });
    if (apply(next)) {
      setZoneLabel('');
      setSelectedType(id);
      setZoneTypesExpanded(true);
    }
  };

  const submitType = (): void => {
    const label = typeLabel.trim();
    if (label === '') {
      setError('У нового типа должно быть название.');
      return;
    }
    const twin = catalog.objectTypes.find((t) => t.label.trim().toLowerCase() === label.toLowerCase());
    if (twin !== undefined) {
      setError(`Тип «${twin.label}» уже есть в справочнике (${twin.id}); дайте новому другое название.`);
      return;
    }
    const width = metres(typeWidth);
    const depth = metres(typeDepth);
    const height = metres(typeHeight);
    if (width === null || depth === null || height === null) {
      setError('Ширина, глубина и высота — числа больше нуля, в метрах.');
      return;
    }
    const { catalog: next, id } = addObjectType(catalog, {
      label,
      category: typeCategory.trim() === '' ? 'Свой тип' : typeCategory,
      size_m: [width, depth],
      height_m: height,
      physical: typePhysical,
      occupiesFloor: typePhysical,
      symbol: typeSymbol,
      color: typeColor,
    });
    if (apply(next)) {
      setTypeLabel('');
      setSelectedType(id);
      setTypesExpanded(true);
    }
  };

  const generatedKey = attributeKeyFromLabel(attrLabel, chosen?.attributes.map((a) => a.key) ?? []);

  const submitAttribute = (): void => {
    if (chosen === null) return;
    if (attrLabel.trim() === '') {
      setError('У атрибута нужна подпись.');
      return;
    }
    const key = attrKey.trim() === '' ? generatedKey : attrKey.trim();
    if (!ATTRIBUTE_KEY.test(key)) {
      setError('Ключ атрибута — латиница, цифры и «_», начинается с буквы: например, serialNumber.');
      return;
    }
    const raw = attrDefault.trim();
    const parsedDefault: NewAttribute['default'] =
      raw === ''
        ? undefined
        : attrType === 'number'
          ? Number(raw.replace(',', '.'))
          : attrType === 'boolean'
            ? BOOLEAN_WORDS[raw.toLowerCase()]
            : raw;
    if (attrType === 'number' && parsedDefault !== undefined && !Number.isFinite(parsedDefault)) {
      setError('Умолчание числового атрибута должно быть числом.');
      return;
    }
    if (attrType === 'boolean' && raw !== '' && parsedDefault === undefined) {
      setError('Умолчание логического атрибута — «да» или «нет».');
      return;
    }
    const next = addAttribute(catalog, chosen.id, {
      key,
      label: attrLabel,
      type: attrType,
      required: attrRequired,
      ...(parsedDefault === undefined ? {} : { default: parsedDefault }),
    });
    if (apply(next)) {
      setAttrKey('');
      setAttrLabel('');
      setAttrDefault('');
    }
  };

  const submitRule = (): void => {
    if (ruleZone === '' || ruleObject === '') {
      setError('Правилу нужны тип зоны и тип оборудования.');
      return;
    }
    const min = bound(ruleMin);
    const max = bound(ruleMax);
    if (min === undefined || max === undefined) {
      setError('Границы правила — целые числа не меньше нуля; пустое поле — без границы.');
      return;
    }
    const { catalog: next } = addCountRule(catalog, {
      zoneTypeId: ruleZone,
      objectTypeId: ruleObject,
      scope: 'inclusive',
      min,
      max,
      rationale: ruleWhy.trim() === '' ? 'Правило добавлено в редакторе.' : ruleWhy,
    });
    if (apply(next)) {
      setRuleWhy('');
      setRulesExpanded(true);
    }
  };

  return (
    <section className="panel catalog" aria-label={SECTION_TITLES[section]}>
          {error === null ? null : (
            <p className="files__error" role="alert" data-testid="catalog-error">
              {error}
            </p>
          )}

          {section !== 'objects' ? null : (
          <div className="panel__group">
          <h3 className="library__category">Новый тип оборудования</h3>
          <div className="catalog__form">
            <label className="assistant__field">
              Название
              <input value={typeLabel} onChange={(e) => setTypeLabel(e.target.value)} data-testid="catalog-type-label" />
            </label>
            <label className="assistant__field">
              Категория
              <input list="catalog-categories" value={typeCategory} onChange={(e) => setTypeCategory(e.target.value)} />
              <datalist id="catalog-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
            <div className="catalog__row">
              <label className="assistant__field">
                Ширина, м
                <input value={typeWidth} onChange={(e) => setTypeWidth(e.target.value)} inputMode="decimal" />
              </label>
              <label className="assistant__field">
                Глубина, м
                <input value={typeDepth} onChange={(e) => setTypeDepth(e.target.value)} inputMode="decimal" />
              </label>
              <label className="assistant__field">
                Высота, м
                <input value={typeHeight} onChange={(e) => setTypeHeight(e.target.value)} inputMode="decimal" />
              </label>
            </div>
            <div className="catalog__row">
              <label className="assistant__field">
                Символ
                <select value={typeSymbol} onChange={(e) => setTypeSymbol(e.target.value as ObjectSymbol)}>
                  {SYMBOLS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="assistant__field">
                Цвет
                <input type="color" value={typeColor} onChange={(e) => setTypeColor(e.target.value)} />
              </label>
              <label className="assistant__field catalog__check">
                <input type="checkbox" checked={typePhysical} onChange={(e) => setTypePhysical(e.target.checked)} />
                занимает пол
              </label>
            </div>
            <button type="button" className="files__button" onClick={submitType} data-testid="catalog-add-type">
              Добавить тип
            </button>
            <p className="panel__note">Размеры можно изменить в свойствах объекта.</p>
          </div>

          <h3 className="library__category">
            Типы и их атрибуты <span className="panel__count">{catalog.objectTypes.length}</span>
          </h3>
          <ul className="catalog__types" data-testid="catalog-types" id="catalog-types-list">
            {catalog.objectTypes.map((type, index) => {
              const count = usedBy(type.id);
              const hidden = index >= headCount(catalog.objectTypes, typesExpanded, COLLAPSE_LIMIT);
              return (
                <li key={type.id} className={type.id === selectedType ? 'is-selected' : ''} hidden={hidden}>
                  <button type="button" className="table__link" onClick={() => setSelectedType(type.id)}>
                    {type.label}
                  </button>
                  <span className="table__muted"> · {type.attributes.length} атр. · на плане {count}</span>
                  <button
                    type="button"
                    className="table__link catalog__remove"
                    title={count > 0 ? 'Тип используется на плане — сначала уберите объекты' : 'Удалить тип'}
                    disabled={count > 0}
                    onClick={() => apply(removeObjectType(catalog, type.id))}
                  >
                    удалить
                  </button>
                </li>
              );
            })}
          </ul>
          {catalog.objectTypes.length > COLLAPSE_LIMIT ? (
            <button
              type="button"
              className="table__link"
              aria-expanded={typesExpanded}
              aria-controls="catalog-types-list"
              data-testid="catalog-types-toggle"
              onClick={() => setTypesExpanded((v) => !v)}
            >
              {typesExpanded ? 'Свернуть' : `Показать все (${catalog.objectTypes.length})`}
            </button>
          ) : null}
          </div>
          )}

          {section !== 'zones' ? null : (
          <div className="panel__group">
          <h3 className="library__category">Новый тип зоны</h3>
          <div className="catalog__form">
            <div className="catalog__row">
              <label className="assistant__field">
                Название
                <input value={zoneLabel} onChange={(e) => setZoneLabel(e.target.value)} data-testid="catalog-zone-label" />
              </label>
              <label className="assistant__field">
                Цвет пола
                <input type="color" value={zoneColor} onChange={(e) => setZoneColor(e.target.value)} />
              </label>
            </div>
            <button type="button" className="files__button" onClick={submitZoneType} data-testid="catalog-add-zone-type">
              Добавить тип зоны
            </button>
          </div>

          <h3 className="library__category">
            Типы зон и их атрибуты <span className="panel__count">{catalog.zoneTypes.length}</span>
          </h3>
          <ul className="catalog__types" data-testid="catalog-zone-types" id="catalog-zone-types-list">
            {catalog.zoneTypes.map((type, index) => {
              const count = zonesOf(type.id);
              const hidden = index >= headCount(catalog.zoneTypes, zoneTypesExpanded, COLLAPSE_LIMIT);
              return (
                <li key={type.id} className={type.id === selectedType ? 'is-selected' : ''} hidden={hidden}>
                  <button type="button" className="table__link" onClick={() => setSelectedType(type.id)}>
                    {type.label}
                  </button>
                  <span className="table__muted"> · {type.attributes.length} атр. · на плане {count}</span>
                  <button
                    type="button"
                    className="table__link catalog__remove"
                    title={count > 0 ? 'Тип используется на плане — сначала смените тип у зон' : 'Удалить тип зоны'}
                    disabled={count > 0}
                    onClick={() => apply(removeZoneType(catalog, type.id))}
                  >
                    удалить
                  </button>
                </li>
              );
            })}
          </ul>
          {catalog.zoneTypes.length > COLLAPSE_LIMIT ? (
            <button
              type="button"
              className="table__link"
              aria-expanded={zoneTypesExpanded}
              aria-controls="catalog-zone-types-list"
              data-testid="catalog-zone-types-toggle"
              onClick={() => setZoneTypesExpanded((v) => !v)}
            >
              {zoneTypesExpanded ? 'Свернуть' : `Показать все (${catalog.zoneTypes.length})`}
            </button>
          ) : null}
          </div>
          )}

          {chosen === null ? null : (
            <div className="catalog__form panel__group" data-testid="catalog-attributes">
              <p className="panel__note">
                {chosenObject === null
                  ? `Атрибуты типа зоны «${chosen.label}»`
                  : `Атрибуты типа «${chosen.label}» — источник: ${chosenObject.provenance}`}
              </p>
              <ul className="catalog__types">
                {chosen.attributes.map((a) => {
                  const readers = layersReading(catalog, a.key);
                  return (
                    <li key={a.key}>
                      {a.label} <span className="table__muted">({a.key}, {a.type}{a.required ? ', обязательный' : ''})</span>
                      {readers.length === 0 ? null : (
                        <span className="table__muted" data-testid="catalog-attr-layer-note">
                          {' '}· читает слой «{readers.map((l) => l.label).join('», «')}»
                        </span>
                      )}
                      <button
                        type="button"
                        className="table__link catalog__remove"
                        title={
                          readers.length === 0
                            ? 'Удалить атрибут'
                            : 'Уже введённые значения слой продолжит рисовать; исчезнут поле в карточке и умолчание для новых объектов и зон'
                        }
                        onClick={() => apply(removeAttribute(catalog, chosen.id, a.key))}
                      >
                        удалить
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="catalog__row">
                <label className="assistant__field">
                  Подпись
                  <input value={attrLabel} onChange={(e) => setAttrLabel(e.target.value)} placeholder="Состояние" data-testid="catalog-attr-label" />
                </label>
              </div>
              <p className="panel__note" data-testid="catalog-attr-key-preview">
                Ключ: {attrKey.trim() === '' ? generatedKey : attrKey.trim()}
              </p>
              {/* A button, not <details>: the Settings Tab trap skips <summary> and cannot focus a field in a closed <details>. */}
              <button
                type="button"
                className="table__link"
                aria-expanded={attrKeyOpen}
                onClick={() => setAttrKeyOpen(!attrKeyOpen)}
                data-testid="catalog-attr-more"
              >
                {attrKeyOpen ? '▾' : '▸'} дополнительно
              </button>
              {attrKeyOpen ? (
                <label className="assistant__field">
                  Ключ
                  <input
                    value={attrKey}
                    onChange={(e) => setAttrKey(e.target.value)}
                    placeholder={generatedKey}
                    data-testid="catalog-attr-key"
                  />
                </label>
              ) : null}
              <div className="catalog__row">
                <label className="assistant__field">
                  Тип
                  <select value={attrType} onChange={(e) => setAttrType(e.target.value as NewAttribute['type'])}>
                    <option value="string">строка</option>
                    <option value="number">число</option>
                    <option value="boolean">да/нет</option>
                  </select>
                </label>
                <label className="assistant__field">
                  Умолчание
                  <input value={attrDefault} onChange={(e) => setAttrDefault(e.target.value)} data-testid="catalog-attr-default" />
                </label>
                <label className="assistant__field catalog__check">
                  <input type="checkbox" checked={attrRequired} onChange={(e) => setAttrRequired(e.target.checked)} data-testid="catalog-attr-required" />
                  обязательный
                </label>
              </div>
              <button type="button" className="files__button" onClick={submitAttribute} data-testid="catalog-add-attr">
                Добавить атрибут
              </button>
            </div>
          )}

          {section !== 'rules' ? null : (
          <div className="panel__group">
          <h3 className="library__category">
            Правила комплектования <span className="panel__count">{catalog.rules.length}</span>
          </h3>
          <ul className="catalog__types" data-testid="catalog-rules" id="catalog-rules-list">
            {catalog.rules.map((rule, index) => (
              <li key={rule.id} hidden={index >= headCount(catalog.rules, rulesExpanded, COLLAPSE_LIMIT)}>
                {rule.kind === 'count'
                  ? `${catalog.zoneTypes.find((z) => z.id === rule.zoneTypeId)?.label ?? rule.zoneTypeId}: «${
                      catalog.objectTypes.find((t) => t.id === rule.objectTypeId)?.label ?? rule.objectTypeId
                    }» ${rule.min === null ? '' : `от ${rule.min}`} ${rule.max === null ? '' : `до ${rule.max}`}`
                  : `«${catalog.objectTypes.find((t) => t.id === rule.objectTypeId)?.label ?? rule.objectTypeId}» не дальше ${rule.maxDistance_m} м от входа`}
                <span className="table__muted">
                  {' '}
                  — {rule.source === 'team-assumption' ? 'справочник проекта' : 'материалы организаторов'}
                </span>
                <button
                  type="button"
                  className="table__link catalog__remove"
                  onClick={() => apply(removeRule(catalog, rule.id))}
                >
                  удалить
                </button>
              </li>
            ))}
          </ul>
          {catalog.rules.length > COLLAPSE_LIMIT ? (
            <button
              type="button"
              className="table__link"
              aria-expanded={rulesExpanded}
              aria-controls="catalog-rules-list"
              data-testid="catalog-rules-toggle"
              onClick={() => setRulesExpanded((v) => !v)}
            >
              {rulesExpanded ? 'Свернуть' : `Показать все (${catalog.rules.length})`}
            </button>
          ) : null}
          <div className="catalog__form">
            <div className="catalog__row">
              <label className="assistant__field">
                Тип зоны
                <select value={ruleZone} onChange={(e) => setRuleZone(e.target.value)} data-testid="catalog-rule-zone">
                  <option value="">—</option>
                  {catalog.zoneTypes.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="assistant__field">
                Оборудование
                <select value={ruleObject} onChange={(e) => setRuleObject(e.target.value)} data-testid="catalog-rule-object">
                  <option value="">—</option>
                  {catalog.objectTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="catalog__row">
              <label className="assistant__field">
                Не меньше
                <input value={ruleMin} onChange={(e) => setRuleMin(e.target.value)} inputMode="numeric" data-testid="catalog-rule-min" />
              </label>
              <label className="assistant__field">
                Не больше
                <input value={ruleMax} onChange={(e) => setRuleMax(e.target.value)} inputMode="numeric" placeholder="без предела" />
              </label>
            </div>
            <label className="assistant__field">
              Почему
              <input value={ruleWhy} onChange={(e) => setRuleWhy(e.target.value)} placeholder="Обоснование правила" />
            </label>
            <button type="button" className="files__button" onClick={submitRule} data-testid="catalog-add-rule">
              Добавить правило
            </button>
            <p className="panel__note">Правило учитывает вложенные зоны.</p>
          </div>
          </div>
          )}
    </section>
  );
}
