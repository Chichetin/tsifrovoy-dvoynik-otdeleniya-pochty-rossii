# Архитектурное ревью 19.09.2026 — что чинить

Обход кода скиллом `improve-codebase-architecture`: ищется не «некрасиво», а места, где
одно правило живёт в нескольких копиях или где поведение нельзя проверить иначе как
браузером. Каждая строка ниже проверена командой на коммите `e006411` (`origin/main`
на 19.09); номера строк — от него, после чужих merge их надо перепроверить `grep`, а не
доверять номеру.

Это не правила проекта и не решения: правила — `CLAUDE.md`, решения — `docs/decisions.md`.
Здесь список задач. Взял строку — заведи worktree по `GIT.md`, добавь строку в
«Активные задачи» `HANDOFF.md`, новая логика в том же коммите закрывается тестом.

Порядок — по отдаче, а не по размеру.

## 1. Снимок «было» ведут две переменные (Strong)

**Статус 19.09:** исправлено в [MR !105](https://git.codenrock.com/codenrock/khakaton-postcode-challenge-ot-pochtatekha/ii-blanki/tsifrovoy-dvoynik-otdeleniya-pochty-rossii/-/merge_requests/105) (D-175):
`baseline` — read-only поле store, `compareBase` и заглушка панели удалены; устаревший
`markExported` закреплён тестом.

**Где:** `src/app/App.tsx:67,147,159,197` (`compareBase`) и `src/state/plan-store.ts:83,159,200`
(`baseline` в замыкании); `src/features/assistant/AssistantPanel.tsx` шлёт в поле `before`
текущий план как заглушку, а `App.tsx:124` подменяет её на `compareBase`.

**Что не так:** один инвариант — «от какого снимка считать эффект изменений» — держат две
переменные и пять мест записи, ни одно не закрыто тестом. `markExported` при устаревшей
`revision` молча ничего не делает (`plan-store.ts:200`), а `setCompareBase(document)`
рядом (`App.tsx:197`) отрабатывает всегда: снимки расходятся, и ассистент показывает
«было → стало» от не того плана. Это критерий 20% и видно жюри.

**Что сделать:** снимок экспорта становится частью контракта store (поле рядом с
`document`/`revision`/`dirty`), `App` его читает, а не ведёт. `AssistantPanel` перестаёт
класть заглушку в `before`.

**Готово, когда:** `compareBase` в `App.tsx` нет; `src/state/plan-store.test.ts` содержит
тест «`markExported` со старой `revision` не меняет снимок»; e2e сценария сравнения зелёный.

**Осторожно:** это изменение контракта `PlanStore` — отдельный согласованный MR (поток 1),
и оно спорит с D-131 («было» ведёт приложение) и с запиской в `src/state/README.md`.
В MR нужна новая строка решения со ссылкой на D-131.

## 2. Ассистент выбирает слой по другому правилу, чем редактор (Strong, дёшево)

**Статус 19.09:** исправлено в [MR !104](https://git.codenrock.com/codenrock/khakaton-postcode-challenge-ot-pochtatekha/ii-blanki/tsifrovoy-dvoynik-otdeleniya-pochty-rossii/-/merge_requests/104) (D-174): четыре
потребителя вызывают `editableContentLayer`, отказ и общий предикат закрыты unit-тестами.

**Где:** `src/domain/advice/placement.ts:391` — `plan.layers.find((entry) => !entry.locked)`.
Три места интерфейса требуют ещё и `typeId === null`:
`src/features/plan-tools/use-plan-tool-controller.ts:72`,
`src/features/equipment/use-equipment-tool-controller.ts:37`,
`src/features/layers/LayersPanel.tsx:77`.

**Что не так:** ассистент может предложить положить объект на информационный слой, что
запрещают D-063 и D-066. Расхождение не ловит ни один тест.

**Что сделать:** одна функция выбора целевого слоя в `src/domain` (рядом с правилами
слоёв), четыре вызова вместо четырёх правил.

**Готово, когда:** unit-тест «план, где единственный незапертый слой — информационный»
даёт отказ, а не размещение; три места интерфейса и `placement.ts` зовут одну функцию.

## 3. «id → человеческое название» существует в трёх видах (Strong)

**Где:** `src/features/validation/naming.ts:13` (`refName`),
`src/features/inventory/rows.ts:26` (`namingOf` + `display`),
`src/features/assistant/AssistantPanel.tsx:64` (`equipmentSubject`),
плюс прямые `plan.zones.find(...)` в `PropertiesPanel.tsx`, `PlanGeometryLayer.tsx`,
`MetricsPanel.tsx`.

**Что не так:** три разных ответа на «имени нет»: сырой `id`, `display()`, скрыть строку.
Причина структурная: `eslint.config.js` запрещает feature импортировать соседнюю feature,
поэтому четвёртый потребитель снова скопирует. Плюс линейный `find` на каждый кадр.

**Что сделать:** модуль в `src/domain` (например `lookup`): `planIndex(plan)` на `Map`,
одно правило подстановки `id`, один способ назвать зону, тип и объект. Панели получают
индекс вместо расширения пропсов `document?`.

**Готово, когда:** `refName`, `namingOf`, `equipmentSubject` удалены; тесты панелей
переписаны на общий модуль; `InventoryPanelViewProps`/`ValidationPanelViewProps` больше
не нужны как расширение контракта (это же снимает долг по D-124 из «Что дальше»).

## 4. Примитивы геометрии живут копиями вне `domain/geometry` (Strong)

**Статус 20.09:** исправлено (D-196): `segmentLength`, `projectOnSegment`, `pointSegmentDistance`, `wallLength`, `wallSpanPolygon` экспортированы из `domain/geometry`; родитель зоны — `parentZoneFor` в `domain/relations`, его зовут рисование и импорт; копии в `vertex-edit`, `wall-draft`, `organizer-import`, `commands`, `view3d`, `plan-svg`, `validation` удалены. Тест «зона из файла и та же зона, нарисованная последней, получают одного родителя» — `relations.test.ts`. Не тронуты `Math.hypot` в `domain/advice` и `room-walls` (локальные расстояния между точками, без второго правила) и в `features/properties`/`PlanGeometryLayer` (показ длины).

**Где (проверено `grep`):**

| Примитив | Канон | Копии |
|---|---|---|
| нормализация угла | `src/domain/geometry/coordinates.ts:16` | `src/domain/commands/index.ts:217`, `src/persistence/organizer-import.ts:388` |
| площадь по формуле шнурков | `src/domain/geometry/polygons.ts:18` | `src/persistence/organizer-import.ts:512` |
| длина стены | `src/features/plan-tools/vertex-edit.ts:98` | девять `Math.hypot` на месте, в том числе `src/domain/geometry/index.ts`, `src/domain/validation/index.ts:382`, `src/features/view3d/scene.ts`, `PropertiesPanel.tsx` |
| проекция точки на отрезок | — | `vertex-edit.ts:45`, `wall-draft.ts:76`, `organizer-import.ts:399`, `room-walls.ts:131` — четыре допуска |
| родитель зоны по геометрии | — | `vertex-edit.ts:126` (самая глубокая) и `organizer-import.ts:494` (самая маленькая) |
| полоса стены | `src/domain/geometry/index.ts:89` (приватная) | `src/features/view3d/scene.ts` переписал математику и в комментарии объяснил, что экспорт «принадлежит владельцу G01» |

**Что не так:** расхождения не косметические. Ручной ввод и импорт дают разный `parentId`
одной и той же зоне, а вложенность зон считает площади и инвентаризацию. Владение модулем
сейчас стоит копии кода.

**Что сделать:** поток 1 экспортирует из `src/domain/geometry` недостающие примитивы
(длина стены, проекция на отрезок, полоса стены, выбор родителя зоны), остальные модули
переходят на них; приватные копии удаляются.

**Готово, когда:** `grep` по `Math.hypot`, `normali[sz]e(Angle|Rotation)`, `shoelace` не
находит копий вне `domain/geometry`; тест «зона, нарисованная руками, и она же после
импорта получают один `parentId`».

## 5. В `src/app/App.tsx` живёт состояние сессии (Worth exploring)

**Где:** `src/app/App.tsx` — 272 строки, ноль unit-тестов; одиннадцать `useState` плюс
`focusSequence`; протокол фокуса разрезан между `App.tsx` и
`src/features/editor/EditorCanvas.tsx`.

**Что не так:** выбор инструмента, вид, фокус, предпросмотр и состояние запроса к
ассистенту проверяются только Playwright. Композиция приложения одновременно принимает
решения.

**Что сделать:** вынести состояние сессии в отдельный модуль (переходы + селекторы,
без React), `App` остаётся склейкой React ↔ сессия.

**Готово, когда:** переходы сессии покрыты обычными тестами в node; `App.tsx` не содержит
логики, кроме подключения.

**Осторожно:** самая крупная строка списка. До сдачи 22.09 браться, только если веха
закрыта и есть свободный поток.

## 6. Правила ввода дублируются по слоям (Worth exploring)

**Где:** `isTypingTarget` в `src/features/editor/EditorCanvas.tsx:49` и
`src/features/equipment/EquipmentLayer.tsx:46`; третья копия `isTextTarget` в
`src/features/plan-tools/PlanGeometryLayer.tsx:59` — уже без проверки `contentEditable`.
Набор видимых слоёв собирается заново в `EquipmentLayer.tsx:94`,
`PlanGeometryLayer.tsx:94`, `InformationLayer.tsx:63`, `view3d/scene.ts:87`.
Delete для объекта живёт отдельно от `src/features/plan-tools/delete-key.ts`, который для
`kind: 'object'` возвращает `null`.

**Что не так:** одно пользовательское правило («что удаляется», «когда клавиша не наша»)
реализовано дважды с разными охранниками; порядок обработки Escape держится комментарием.

**Что сделать:** правила ввода и доступности элемента по слоям — один модуль; слои его
исполняют.

**Готово, когда:** копии `isTypingTarget` удалены; правило скрытого и запертого слоя
проверяется unit-тестом, а не только `tests/e2e/equipment.spec.ts`.

## 7. Четыре генератора `id`, ни один не видит удалённые (Worth exploring)

**Где:** `src/features/plan-tools/use-plan-tool-controller.ts:35`,
`src/features/plan-tools/wall-draft.ts:38`,
`src/features/equipment/use-equipment-tool-controller.ts:15`,
`src/domain/commands/room-walls.ts:224`; набор `retired` закрыт в замыкании
`src/state/plan-store.ts`.

**Что не так:** правило D-019 («удалённый `id` не переиспользуется») держится только тем,
что store отклоняет команду. Ошибка вылезает как отказ команды, а не как выданный `id`.

**Что сделать:** выдача `id` — часть контракта документа; вызывающие получают `id`, а не
правило его сборки.

**Готово, когда:** приватных `nextId` не осталось; тест «после удаления и повторной
вставки `id` не совпадает с удалённым» проходит без участия UI.

## Что в порядке и трогать не нужно

- Границы модулей соблюдаются: ни одна feature не импортирует соседнюю, `zustand` виден
  только из `src/app/App.tsx`.
- `past`, `future`, `baseline`, `retired` закрыты в замыкании store — история наружу не течёт.
- Расчёты (`domain/*`) покрыты тестами плотно: 1 416 строк тестов на 1 481 строку кода
  в `domain/advice`, сопоставимо в `commands`, `metrics`, `inventory`.
- Правило «модель ↔ экран» соблюдается везде: своих преобразований координат в слоях нет.
