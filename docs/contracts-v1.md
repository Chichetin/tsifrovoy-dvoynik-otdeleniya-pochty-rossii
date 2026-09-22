# Предлагаемые контракты v1

Статус: проект для заморозки в F02, не существующий API. Основание —
[архитектура](architecture.md). В F02 эти определения переводятся в TypeScript/Zod
и fixtures; до его merge участники не создают собственные несовместимые версии типов.
Имена ниже — имена внешних интерфейсов, внутреннее устройство свободно.

## Документ

```ts
type Id = string;
type Point = [number, number];
type Polygon = Point[]; // Unclosed ring, >= 3 vertices, no holes.
type Attributes = Record<string, string | number | boolean | null>;
type Ref = { kind: 'room' | 'zone' | 'object' | 'layer' | 'wall' | 'opening'; id: Id };
type Result<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };
type Issue = {
  code: string; severity: 'error' | 'warning'; message: string;
  refs: Ref[]; path?: string; polygon?: Polygon;
};
type Layer = {
  id: Id; name: string; visible: boolean; locked: boolean; order: number;
  typeId: Id | null; // null — обычный слой объектов; иначе тип из Catalog.layerTypes
};
type Zone = {
  id: Id; typeId: Id; name: string; polygon: Polygon;
  parentId: Id | null; layerId: Id; attributes: Attributes;
};
type Equipment = {
  id: Id; typeId: Id; label: string; position: Point; size_m: Point;
  rotation_deg: number; base_m: number; height_m: number;
  zoneId: Id | null; layerId: Id; attributes: Attributes;
  outline?: Polygon; // D-277: доли size_m, до поворота, рамка ровно [-0.5, 0.5]
};
type Wall = { id: Id; from: Point; to: Point; thickness_m: number; height_m: number };
type Opening = {
  id: Id; wallId: Id; offset_m: number; width_m: number;
  kind: 'entrance' | 'door' | 'window'; sill_m: number; height_m: number;
};
type AttributeDef = {
  key: string; label: string; type: 'string' | 'number' | 'boolean';
  required: boolean; default?: string | number | boolean;
};
type ObjectType = {
  id: Id; label: string; category: string; defaultSize_m: Point;
  defaultHeight_m: number; defaultBase_m: number;
  physical: boolean; occupiesFloor: boolean;
  symbol: 'rect' | 'circle' | 'triangle'; outline?: Polygon; color: string;
  attributes: AttributeDef[]; provenance: string;
};
type ZoneType = { id: Id; label: string; color: string; attributes: AttributeDef[] };
type RuleSource = {
  id: Id; source: 'team-assumption' | 'organizer-material'; rationale: string;
};
type Rule = RuleSource & (
  | { kind: 'count'; zoneTypeId: Id; objectTypeId: Id;
      scope: 'direct' | 'inclusive'; min: number | null; max: number | null }
  | { kind: 'distance-to-entrance'; objectTypeId: Id; maxDistance_m: number;
      entranceId: Id | null }
);
type LayerRepresentation =
  | { kind: 'objects' }
  | { kind: 'zone-heat'; attribute: string; unit: string; max: number;
      colors: [string, string] }
  | { kind: 'zone-count'; attribute: string; unit: string; color: string }
  | { kind: 'object-field'; objectTypeIds: Id[];
      angleAttribute: string; rangeAttribute: string;
      angle_deg: number; range_m: number; color: string };
type LayerType = {
  id: Id; label: string; representation: LayerRepresentation; note: string;
};
type Catalog = {
  version: string; objectTypes: ObjectType[]; zoneTypes: ZoneType[];
  layerTypes: LayerType[]; rules: Rule[];
};
type PlanDocument = {
  schemaVersion: 1; id: Id; name: string;
  room: { id: Id; boundary: Polygon; ceilingHeight_m: number };
  walls: Wall[]; openings: Opening[]; layers: Layer[];
  zones: Zone[]; objects: Equipment[]; catalog: Catalog;
  extensions: Record<string, unknown>;
};
```

`extensions` содержит только JSON-значения. Данные каталога входят в экспорт; изменение
глобального каталога не переписывает уже открытый документ. Обновление каталога — явная
операция с preview ошибок. Неизвестный тип в документе — ошибка со ссылкой на объект,
не молчаливое удаление. Неизвестные дополнительные данные импортера — в `extensions`.
Для count-правила область определяется scope явно, default отсутствует. По каждому
экземпляру зоны соответствующего типа выдаётся отдельный результат; inclusive включает
потомков и дедуплицирует object ID. Distance-правило измеряет евклидово расстояние от
центра объекта до середины входного проёма. entranceId=null означает ближайший вход;
если входов нет, результат «невозможно проверить», не «соответствует». Правило ≤3 м
лежит в rules.json с source=organizer-material; это не проверка доступности пути.
При переносе каталога в другой план неизвестный entranceId даёт явную ошибку ссылки.

Информационный слой (`typeId != null`) ничего не содержит: он рисует поверх всего плана —
все зоны для `zone-heat`/`zone-count`, все объекты перечисленных типов для `object-field`.
Включение слоя не меняет документ и не поднимает ревизию (D-063). Представление только
читает атрибуты; зона или объект без нужного атрибута просто не окрашивается. `note` типа
слоя обязателен и печатается рядом со слоем: числа синтетические. `typeId` слоя и
`catalog.layerTypes` необязательны во входном файле — их отсутствие означает обычные слои
и пустой список, поэтому файлы, сохранённые до этой правки, открываются без миграции (D-064).

Уникальность ID — глобально среди сущностей плана; ID типов и правил имеют отдельные
пространства. В слоях всегда есть хотя бы один слой. Размеры/высоты положительны,
координаты конечны, `base_m >= 0`, угол нормализован в `[0,360)` при командах.

## Геометрические правила

- Пусть локальная точка объекта `(dx,dy)`, угол `a` в радианах. Мировая:
  `(cx + dx*cos(a) + dy*sin(a), cy - dx*sin(a) + dy*cos(a))`.
  При +90° локальный вектор `(1,0)` становится `(0,-1)`.
- `screen = [originX + x*scale, originY - y*scale]`; обратное преобразование точное
  в пределах допуска. Экранный Transformer не определяет соглашение модели.
- Допуск координат 1e-6 м, площадей 1e-8 м². Касание границ без положительной
  площади пересечения не считается коллизией; зазор проходов — отдельное правило.
- Полигоны проверяются на самопересечение и вырождение до булевых операций.
  Геометрически невычислимый документ возвращает `Result` с ошибкой, не `NaN`.
- Проверка содержит весь footprint, а не только центр или вершины: это важно для
  вогнутых зон. Принадлежность самой глубокой зоне; при равной глубине и нескольких
  вариантах `zoneId=null` + `ZONE_AMBIGUOUS`.
- `reconcileZones` вызывается после правки геометрии/иерархии зон и объектов.
  Импорт сохраняет заявленные связи и показывает расхождения; явная команда исправляет их.
- Пересечение физических объектов требует положительного перекрытия и по XY, и по
  `[base_m,base_m+height_m]`. Скрытие слоя не отключает проверки или инвентаризацию.
- Занятость пола включает только `occupiesFloor=true`; объединение обрезается целевой
  областью. Метрики зоны включают геометрию внутри зоны, а не только назначенные ей объекты.
  Статистика по зонам имеет direct и inclusive режимы: в inclusive один объект может
  присутствовать у предка, но общий итог считают по уникальным ID.
- Толщину стен в площадь занятого оборудования не включаем; граница помещения задаёт
  площадь комнаты. Пересечения оборудования со стенами проверяем отдельно, с вычитанием
  проёмов в соответствующем диапазоне высот. Ограничение метрики явно видно в UI.

## Чистые функции и команды

```ts
type Viewport = { origin: Point; scale: number };
type ZoneResolution = { zoneId: Id | null; issues: Issue[] };
type AreaMetrics = { total_m2: number; occupied_m2: number; free_m2: number };
type Metrics = { room: AreaMetrics; zones: Record<Id, AreaMetrics> };
type Inventory = {
  rows: Equipment[]; byType: Record<Id, number>;
  byZoneDirect: Record<Id, number>; byZoneInclusive: Record<Id, number>; unassigned: number;
};
// src/domain/geometry
// footprint(object): Polygon
// contains(container: Polygon, shape: Polygon): boolean
// intersects(a: Polygon, b: Polygon): boolean
// modelToScreen(point: Point, viewport: Viewport): Point
// screenToModel(point: Point, viewport: Viewport): Point
// src/domain/relations
// resolveZone(object: Equipment, zones: Zone[]): ZoneResolution
// reconcileZones(plan: PlanDocument): Result<PlanDocument>
// src/domain/metrics
// measurePlan(plan: PlanDocument): Result<Metrics>
// src/domain/catalog
// validateCatalog(catalog: Catalog): Issue[]
// src/domain/inventory
// buildInventory(plan: PlanDocument): Inventory
// src/domain/validation
// validatePlan(plan: PlanDocument): Issue[]
type Command =
  | { type: 'room.set'; boundary: Polygon }
  | { type: 'zone.put'; zone: Zone }
  | { type: 'zone.delete'; id: Id }
  | { type: 'object.put'; object: Equipment }
  | { type: 'object.delete'; id: Id }
  | { type: 'layer.put'; layer: Layer }
  | { type: 'layer.delete'; id: Id; moveTo: Id }
  | { type: 'wall.put'; wall: Wall }
  | { type: 'wall.delete'; id: Id }
  | { type: 'opening.put'; opening: Opening }
  | { type: 'opening.delete'; id: Id }
  | { type: 'catalog.replace'; catalog: Catalog }
  | { type: 'plan.rename'; name: string }
  | { type: 'room.setCeiling'; ceilingHeight_m: number }
  | { type: 'relations.reconcile' }
  | { type: 'batch'; commands: Command[] };
// applyCommand(plan: PlanDocument, command: Command, retired?: Iterable<Id>): Result<PlanDocument>
// decodePlan(text: string): Result<PlanDocument>
// encodePlan(plan: PlanDocument): Result<string>
// importOrganizerExample(input: unknown): Result<PlanDocument>
```

Команда put создаёт или заменяет сущность целиком, ID генерируется до команды;
удалённый ID не переиспользуется — `PlanStore.retired` и `EditorSession.retired`
отдают такие id инструментам, чтобы они не выдавали их новым сущностям (D-156). Изменение типа через object.put сохраняет ID,
позицию и размер; атрибуты проверяются по новому типу, не удаляются молча.
Неизвестные атрибуты сохраняются и предупреждаются; обязательные получают defaults
или команда отклоняется. Удаление зоны переподчиняет детей её родителю и пересчитывает
связи; удаление слоя требует переноса содержимого в существующий слой. Удаление стены
удаляет её проёмы в той же undo-операции. Locked-слой отклоняет команды изменения
его содержимого. Геометрические нарушения сохраняются как диагностируемое состояние.
`reconcileZones` возвращает ok:true даже при неназначенных объектах: zoneId=null,
диагностику выдаёт validatePlan; ok:false — только при структурной ошибке.
Если геометрия комнаты или любой зоны невычислима, для промежуточного документа
все zoneId выставляются в null; validatePlan показывает первичную ошибку полигона и
«связи требуют пересчёта». Исходный снимок сохраняется в undo. Следующая корректная
правка снова назначает зоны автоматически. contains/metrics на таком полигоне не
вызываются; рекомендации отключены до исправления. Импорт по-прежнему сохраняет
заявленные связи до первой явной команды. Обязательный тест S01: валидный план →
самопересечение зоны → успешное сохранение промежуточного состояния → исправление
следующей командой → связи восстановлены → undo возвращает каждый предыдущий снимок.
Поэтому перемещение за границу и промежуточный неверный полигон не теряют жест.

`batch` — несколько команд как одна правка: шаги применяются по порядку, отказ любого —
отказ пакета с его кодом и нетронутый план; пустой пакет отклоняется (`BATCH_EMPTY`).
Групповой перенос и групповое удаление — это `batch`, поэтому у них одно «Отменить».

Store-интерфейс: `dispatch(command): Result<PlanDocument>`, `replaceDocument(plan)`
после подтверждения dirty, `undo()`, `redo()`, `select(ref: Ref|null)`,
`selectMany(ids: Id[])`; `document`, `revision:number`, `selection`, `selected`, `dirty`
доступны только для чтения. `selected: ReadonlySet<Id>` — объекты, выбранные группой
(рамка, Shift+клик); `selection` — главный из них: то, что показывают карточка и 3D.
Инварианты: каждый id группы — объект документа; непустая группа содержит главного;
`select(ref)` даёт группу из одного объекта (или пустую для зоны и `null`);
`selectMany` отбрасывает чужие id, главным делает последний в переданном порядке;
удаление главного передаёт роль последнему оставшемуся; `replaceDocument` очищает группу.
Выбор не меняет `revision` и `dirty`.
Удачный dispatch/replace/undo/redo увеличивает revision. Сохранение не меняет revision.
`markExported(revision:number): void` отмечает только актуальную revision после
успешной подготовки файла; устаревшая revision игнорируется. Store публикует только для
чтения `baseline: PlanDocument` — единый снимок для `dirty` и сценария сравнения
ассистента. Он принимается через replaceDocument или markExported; dirty — сравнение содержимого
документа с baseline, поэтому undo к нему сбрасывает dirty. Это отметка подготовленного
экспорта, не подтверждение записи на диск. Новое несохранённое помещение и восстановление
черновика получают dirty=true; ошибка скачивания не меняет baseline. Черновик его
не сбрасывает. replaceDocument получает режим `origin: 'file'|'new'|'draft'` и выполняется
только после подтверждения замены. Undo/redo не возвращают старое числовое значение revision.
Persisted-документ не содержит revision, selection, историю или ответ модели.

## Ассистент и HTTP

```ts
type AdviceRequest =
  | { scenario: 'place'; typeId: Id; zoneId: Id | null; anchor?: Point }
  | { scenario: 'equipment'; zoneId: Id | null }
  | { scenario: 'compare'; before: PlanDocument };
type MetricCode = 'area.total' | 'area.occupied' | 'area.free' | 'equipment.count'
  | 'equipment.min' | 'equipment.max' | 'objects.added' | 'objects.removed'
  | 'placement.distance';
type ReasonCode = 'placement.available' | 'placement.none' | 'equipment.missing'
  | 'equipment.excess' | 'comparison.changed' | 'comparison.unchanged';
type Fact = {
  id: Id; metric: MetricCode; phase: 'current' | 'before' | 'after' | 'delta';
  value: number; unit: 'm' | 'm2' | 'count'; refs: Ref[];
};
type Candidate = { id: Id; object: Equipment; facts: Fact[] };
type Recommendation = {
  id: Id; scenario: AdviceRequest['scenario']; refs: Ref[];
  candidates: Candidate[]; facts: Fact[]; ruleIds: Id[]; assumptions: string[];
  reasonCodes: ReasonCode[]; limitations: string[];
  changes: { ref: Ref; kind: 'added' | 'removed' | 'moved' | 'updated' }[];
};
type Explanation = { recommendationId: Id; candidateId: Id | null; reasonCode: ReasonCode; factIds: Id[] };
type AdviceResponse = {
  revision: number; recommendations: Recommendation[];
  explanations: Explanation[]; mode: 'llm' | 'fallback'; fallbackReason?: string;
};
// findPlacements(plan, request: Extract<AdviceRequest,{scenario:'place'}>): Result<Candidate[]>
// checkEquipment(plan, request: Extract<AdviceRequest,{scenario:'equipment'}>): Recommendation[]
// comparePlans(before: PlanDocument, after: PlanDocument): Result<Recommendation[]>
// calculateAdvice(plan: PlanDocument, request: AdviceRequest): Result<Recommendation[]>
// verifyExplanation(input: unknown, recommendations: Recommendation[]): Result<Explanation[]>
```

Семантический словарь F02 (`src/contracts/advice-semantics.ts`) задаёт:

| reasonCode | Условие допустимости | Обязательные факты/шаблон |
|---|---|---|
| placement.available | candidateId принадлежит рекомендации, кандидат прошёл геометрию | Текущая/прогнозная area.free, equipment.count; координаты/размер из Candidate |
| placement.none | candidates пуст, candidateId=null | Ограничения сетки и бюджета; нельзя говорить «места не существует» |
| equipment.missing | count < min в одной области refs | equipment.count, equipment.min; разницу вычисляет шаблон |
| equipment.excess | count > max в одной области refs | equipment.count, equipment.max; разницу вычисляет шаблон |
| comparison.changed | хотя бы один рассчитанный delta != 0; перемещение попадает в дельту как измеренное расстояние `placement.distance` | Пары before/after по каждой показываемой метрике; знак вычисляет шаблон |
| comparison.unchanged | все рассчитанные delta нулевые | Сообщение о том, что показатели не изменились; правки, невидимые показателям, перечислены в `changes` и в `limitations` |

`area.*` имеет unit=m2, `placement.distance` — m, остальные — count. Значения конечны;
count целые, отрицательные значения допустимы только для phase=delta. Before/after
связываются по metric и одинаковой области refs; delta=after-before. Прогноз кандидата
считается на копии плана, не в UI. `reasonCodes` формирует расчёт; модель выбирает
только уже допустимый код. verifyExplanation проверяет эту таблицу, не только наличие
ID. F02 публикует позитивные и негативные fixtures каждого кода, A03 и A04 тестируются
одним корпусом. Полный diff сравнения хранится в `Recommendation.changes`:
`{ref:Ref; kind:'added'|'removed'|'moved'|'updated'}[]`; для остальных сценариев [].
Шаблон comparison.changed показывает и изменения без числового эффекта.

Для будущего объекта candidate ID и object ID зарезервированы, но ещё не существуют
в плане. `refs` рекомендации ссылаются только на существующие сущности; новые ID находятся
только в candidates. При ручном добавлении UI показывает параметры кандидата, но не
требует от пользователя копировать ID. Сравнение показывает реальные ID двух снимков,
добавленные/удалённые отдельно; validator проверяет refs относительно объединения этих
снимков именно в compare-сценарии. Числа из LLM не принимаются: модель возвращает factIds.

`POST /api/advice`: JSON `{plan, revision, request, query?: string}` → `AdviceResponse`.
Сервер валидирует оба снимка, считает рекомендации сам, затем вызывает провайдера.
400 — неверная структура; 413 — >5 MiB; 422 — геометрия не позволяет расчёт;
429 — серверный лимит; 200/fallback — ошибка внешнего LLM, расчёт доступен.
Timeout внешнего API — 15 с, не более одного повтора в общем бюджете 20 с.
`query` ≤2000 символов; лимиты v1: 2000 объектов, 200 зон, 256 вершин на полигон и
20000 вершин суммарно; F02 фиксирует их в схеме. Эти ограничения не равны замеру быстродействия.
Браузер при сетевой ошибке/429 формирует fallback из своего такого же расчёта.
`GET /api/health` → `{status:'ok', llm: {configured:false} | {configured:true, provider}}` — `provider` только имя из `LLM_PROVIDER`; ключей, адресов и model ID в ответе нет (D-200).

## Контрактные fixtures и поведение UI

F02 публикует `src/contracts/fixtures/`: `minimal.json`, `nested.json`, `rotated.json`,
`invalid-links.json`, `collision.json`, `advice.json`, `future-version.json`.
В advice.json — все три сценария и позитивные/негативные случаи ReasonCode.
Файлы служат примерами и проверяются схемой; намеренно ошибочные имеют отдельные
ожидаемые коды. Демо сдачи создаётся позже через редактор.

Общие UI-props в `src/contracts/ui.ts`: `{document, revision, selection, onSelect,
onCommand}` с типами выше; панели без редактирования получают только нужные поля.
`EditorCanvas` принимает `children` — слои фигур от app-композиции. Его pointer-события
отдают мировую Point; UI инструментов не пересчитывает Y самостоятельно.
Preview рекомендаций: `EquipmentLayer` дополнительно принимает
`preview: Candidate | null`; отображает его отдельно без изменения документа.
`InventoryPanel` получает Inventory, `ValidationPanel` — Issue[], `AssistantPanel` —
AdviceResponse и состояние запроса. Props 3D — только PlanDocument и selection.
Загрузка/ошибка/пустой результат различаются; строки ошибок доступны в DOM,
клик по Ref выделяет и приближает объект, в том числе временно раскрывает скрытый слой.


### Стыки инструментов редактора

F02 фиксирует следующие типы в `src/contracts/ui.ts`, а F01 создаёт отдельный
тестовый entry `tests/harness/` для браузерных тестов модулей:

```ts
type Tool =
  // 'measure' — линейка (D-256): единственный вид, который план не меняет
  | { kind: 'select' | 'pan' | 'measure' | 'room.draw' | 'zone.draw' | 'wall.draw' | 'opening.place' }
  | { kind: 'object.place'; typeId: Id };
type WorldPointer = {
  phase: 'down' | 'move' | 'up' | 'cancel'; point: Point;
  shift: boolean; alt: boolean; button: number;
};
type FocusRequest = { ref: Ref; sequence: number };
type ToolController = {
  handlePointer(event: WorldPointer): void;
  cancel(): void;
  draft: Point[] | null;
};
type EditorSession = {
  tool: Tool; viewport: Viewport; selection: Ref | null;
  preview: Candidate | null; focus: FocusRequest | null;
};
// Tool changes and focus requests are coordinated by src/app, not persisted.
// EditorCanvas props: document, session, onPointer(WorldPointer),
// onViewport(Viewport), onSelect(Ref|null), children: ReactNode.
// PlanTools: document, session, onTool(Tool), onCommand(Command).
// PlanGeometryLayer: document, session, draft: Point[]|null,
// onCommand(Command), onSelect(Ref|null).
// U03 exports usePlanToolController({document, session, onCommand}): ToolController.
// U04 exports useEquipmentToolController({document, session, onCommand}): ToolController.
// EquipmentLayer: document, session, onCommand(Command), onSelect(Ref|null).
// LibraryPanel: catalog, onTool(Tool); selects object.place, app routes world click.
// ValidationPanel/InventoryPanel: issues/inventory, onFocus(Ref).
// AssistantPanel: document, revision, response, onPreview(Candidate|null), onFocus(Ref).
```

Все координаты фигур проходят функции geometry с одним session.viewport. EditorCanvas
не масштабирует children второй раз. onPointer отдаёт мировые координаты; для cancel
используется последняя точка жеста. U04 обрабатывает жест выбранной фигуры и прекращает
всплытие события; пустой холст передаёт событие активному инструменту через app:
room/zone/wall/opening → usePlanToolController.handlePointer (U03),
object.place → useEquipmentToolController.handlePointer (U04); select/pan обрабатывает
EditorCanvas. Escape вызывает cancel активного контроллера. Алгоритм рисования и
создания оборудования не переносится в app. U07 только выбирает typeId и Tool;
U04 создаёт экземпляр по defaults снимка каталога документа. Панели
не подписываются на глобальные pointer events. FocusRequest разрешается холстом через
геометрию Ref; app временно раскрывает скрытый слой только для просмотра, не меняя файл.
Preview полупрозрачен и не создаёт команды; выход из ассистента его снимает.
Один click размещения создаёт один новый ID; существующая фигура никогда не выбирается
для создания по совпадению ID. onCommand возвращает Result, ошибка доступна инструменту.

UI-пакет сам владеет своим `tests/harness/<package-id>.tsx` и своим spec; F01 предоставляет
общий загрузчик harness по имени fixture/module без production-регистра модулей. Общий
загрузчик не редактируется всеми агентами: соглашение имён и import.meta.glob фиксирует F01.
В изоляции принимаются жесты/props/ошибки модуля, в U01/Q01 — связывание и сценарий целиком.
