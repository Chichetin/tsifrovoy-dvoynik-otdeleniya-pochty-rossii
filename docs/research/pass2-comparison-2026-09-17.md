# PASS-2 — сопоставление независимого исследования с текущим проектом

**Дата анализа:** 17.09.2026  
**Снимок проекта:** `main a25cbd7` по `CURRENT_CONTEXT.md`  
**Первый независимый отчёт:** зафиксирован отдельно и не изменяется этим документом.  
**Граница проверки:** пакет `02-project-context.zip` содержит документы и выбранные исходники, но не весь репозиторий. Полный `npm test` / Playwright / production build / живой деплой в рамках этого прохода не запускались. Числа тестов ниже, если упомянуты, являются **отчётами команды из HANDOFF**, а не результатом моего запуска.

## Легенда доказательств

- **STATIC** — утверждение проверено чтением приложенного исходника.
- **DOC** — утверждение следует из актуального проектного документа/HANDOFF; собственным запуском не подтверждено.
- **WEB** — проверено по первичному внешнему источнику 17.09.2026.
- **RUN REQUIRED** — вывод нельзя закрыть без живого запуска, полного репозитория или ключа API.

---

# 0. Вывод второго прохода

Первый вывод в целом выдержал столкновение с реальной реализацией. **Менять стек не нужно.** Текущий проект уже построен вокруг тех же базовых принципов, которые были рекомендованы независимо:

1. один `PlanDocument` как источник истины;
2. Konva — слой 2D-представления, а не формат данных;
3. отдельное детерминированное геометрическое ядро;
4. каталог типов и правил как данные;
5. инвентаризация/площади/проверки/3D/AI — производные от одного документа;
6. LLM не считает числа и проходит проверку ссылок на известные факты;
7. при недоступности API остаётся полноценный baseline;
8. 3D строится из той же геометрии.

Поэтому максимальная отдача до вечера **21.09** — не в новых архитектурных слоях и не в миграции renderer, а в доказуемом завершении продукта:

**критический путь сейчас:**  
`IO03 defect → D01 hardening → actual provider smoke → Q01 → Q02 → E01 → I01 → E02/release`.

Самое важное изменение приоритета относительно текущего HANDOFF: **не ставить создание новых перегородок/проёмов из UI впереди Q02, E01, живого деплоя и известных дефектов IO03/D01.** Эти инструменты полезны, но не являются тем местом, где сейчас лежит основной конкурсный риск.

---

# 1. Сопоставление решений

| Наше текущее решение | Вердикт | Доказательство и путь/символ | Минимальная правка | Цена / риск | Затронутые пакеты | Критерий приёмки |
|---|---|---|---|---|---|---|
| **Один канонический `PlanDocument`; UI/3D/AI читают его как источник истины** | **Согласен** | **STATIC:** `src/contracts/model.ts: PlanDocument`; **DOC:** `docs/architecture.md §3`, `CURRENT_CONTEXT.md:11` | Не менять. Заморозить v1 после E01 | Низкая цена; высокий риск при поздней смене | F02/S01/IO01 + все потребители | save→reopen сохраняет семантику; JSON не содержит Konva/Three state |
| **React + Konva/react-konva, собственный domain state** | **Согласен** | `package.json`; `docs/architecture.md §2`; Konva официально даёт Transformer/drag/resize/rotate | Не мигрировать на SVG/Fabric. Только исправлять UX текущего editor | Миграция сейчас — высокий риск | U01–U07 | drag/rotate/resize/zoom/undo проходят Q01; resize сохраняет доменные `size_m`, а не renderer scale |
| **Konva — renderer, а не сериализуемая модель** | **Согласен** | `docs/architecture.md:85–89`; model не содержит renderer-полей | Ничего архитектурного | Низкий | U02/U04/IO01 | открытый после сохранения план идентичен по доменным полям |
| **`polyclip-ts` для union/intersection свободной площади** | **Согласен с оговоркой** | **STATIC:** `src/domain/metrics/index.ts` использует `polyclip-ts` для union/intersection; **WEB:** upstream заявляет `union/intersection/difference/xor` | Не менять библиотеку, если Q02 и geometry fixtures стабильны. Добавить только недостающие property/regression cases | Смена сейчас дороже пользы; риск — численные corner cases | G03/Q01/Q02 | sample traps + concave/rotated/touch + 100/500/1000 не дают NaN/negative beyond tolerance |
| **Tolerance: `1e-6 m`, `1e-8 m²`; касание ≠ коллизия** | **Согласен** для MVP | **STATIC:** `src/contracts/model.ts:TOLERANCE`; `src/domain/geometry/polygons.ts` | Не «подкручивать по ощущениям». Менять только после воспроизводимого failing fixture | Низкая | G01/V01 | edge-touch не collision; positive-overlap стабильно collision |
| **Один `zoneId`; самая глубокая зона, содержащая весь footprint** | **Согласен** | **DOC:** `docs/architecture.md:124–126`; contract `Equipment.zoneId`; G02 описан в HANDOFF | Не менять семантику. В README объяснить direct vs inclusive inventory | Низкая | G02/M01/E02 | nested fixture: объект имеет один direct `zoneId`, родитель получает его только в inclusive-счёте |
| **`physical` и `occupiesFloor` разделены; высота учитывается в collision** | **Согласен** | **STATIC:** `ObjectType.physical/occupiesFloor`, `Equipment.base_m/height_m`; `objectsShareSpace()` проверяет XY+Z; каталог: компьютер на столе `occupiesFloor:false` | Не упрощать обратно до одной 2D-коллизии | Низкая | C01/G01/G03/V01 | камера/настольный объект не отнимают пол и не конфликтуют с нижним объектом без Z-overlap |
| **Каталог типов/атрибутов/правил — JSON, снимок каталога в плане** | **Согласен** | **STATIC:** `data/catalog/*.json`, 25 object types; model `Catalog`; **DOC:** C01/U06 | Только убедиться, что E01 содержит собственный добавленный тип/атрибут как демонстрационное доказательство расширяемости | Низкая | C01/U06/E01 | новый тип+атрибут добавляются данными и переживают save/reopen без правки business code |
| **Информационные слои: камеры, загрузка, сотрудники, очередь; синтетическое происхождение подписано** | **Согласен** | **STATIC:** `data/catalog/layer-types.json`; note явно маркирует синтетические значения | Не расширять аналитику. Проверить легенду в реальном UI | Низкая | U05/C01/E01 | toggle слоя меняет представление, не модель; рядом видна маркировка «синтетические» |
| **LLM только выбирает `recommendationId/candidateId/reasonCode/factIds`; текст — шаблон** | **Согласен по достоверности; частично оспариваю по конкурсной демонстрации AI** | **STATIC:** `server/advice-route.ts:SYSTEM_PROMPT`, `src/domain/advice/explanation.ts:verifyExplanation`, строгий Zod shape | **Не ослаблять проверку.** Минимально сделать вклад модели видимым: UI должен явно показывать, какой вариант/причину выбрала модель из рассчитанных кандидатов и какими `factIds` обосновала. Если UI уже это делает — код не менять, только продемонстрировать | 1–3 ч UI/копирайт; риск низкий | A04/A05/A06/E01 | при `mode=llm` зритель отличает вклад модели от baseline; неизвестный fact/extra field всё ещё приводит к fallback |
| **Один OpenAI-compatible клиент для Qwen/DeepSeek; GigaChat/Yandex требуют отдельного пути** | **Согласен с текущим scope** | **STATIC:** `server/llm-client.ts`; **WEB:** DeepSeek и Qwen поддерживают `response_format:json_object`; Yandex имеет OpenAI-compatible base, GigaChat имеет собственную auth/форматы | Не делать четыре адаптера. До 19.09 выбрать **один реально работающий** provider/key/model. Новый адаптер писать только если у команды нет рабочего Qwen/DeepSeek | Ключ — внешний блокер; лишние адаптеры — высокий риск | A05/I01 | один authenticated smoke даёт `mode=llm`; endpoint/model записаны в release notes без секрета; fallback проверен отдельно |
| **`response_format: {"type":"json_object"}` + локальная Zod/semantic validation** | **Согласен** | **STATIC:** `server/llm-client.ts`; **WEB:** DeepSeek требует JSON-инструкцию в prompt; Qwen JSON Object тоже требует слово JSON. Текущий system prompt содержит JSON | Сохранять локальную проверку даже если provider умеет JSON Schema | Низкая | A04/A05 | malformed/empty/unknown IDs → fallback, а не частично доверенный текст |
| **3D — производный `buildScene(plan)` + Three.js extrusion** | **Согласен, но есть подтверждённые дефекты** | **STATIC:** `src/features/view3d/scene.ts:buildScene`, `View3D.tsx`, `View3DCanvas.tsx`; Three `ExtrudeGeometry` подходит для экструзии | Исправить три вещи: фильтровать zone/object по `layer.visible`; освобождать WebGL probe; обработать `webglcontextlost` понятным сообщением | 2–4 ч; риск среднего уровня для live demo | D01/Q01 | скрытый слой исчезает в 3D; 20–50 переключений 2D↔3D не копят контексты; искусственная потеря context не оставляет чёрный canvas |
| **WebGL availability probe через `canvas.getContext()`** | **Оспариваю реализацию, не идею** | **STATIC:** `View3D.tsx:webglAvailable()` получает контекст и не вызывает `WEBGL_lose_context`; **WEB:** Three рекомендует освобождать GPU resources, имеет `forceContextLoss()` на renderer | Сделать probe с освобождением контекста либо один раз на уровне приложения; не создавать новый probe на каждый mount | Маленькая правка | D01 | stress-toggle не приближает браузер к лимиту WebGL contexts |
| **Черновик + предложение восстановить при старте** | **Согласен с функцией; подтверждён дефект состояния** | **STATIC:** `FileControls.tsx`: пока `offered !== null`, draft writer остановлен; `Новый`/`Открыть` не вызывают `setOffered(null)`; `restore()` может затем заменить новый/opened plan | При `New/Open` явно resolve/dismiss pending draft; после открытия файла старое предложение не должно оставаться actionable. Добавить browser test | 1–2 ч; высокий UX/data-loss риск | IO03/Q01 | сценарий: есть draft → Open B → старое «Восстановить» не может без нового явного подтверждения заменить B; draft policy однозначна |
| **Создание новых перегородок/проёмов из UI — ближайшая задача U03** | **Оспариваю приоритет, не функциональность** | **DOC:** HANDOFF ставит U03 рядом с ближайшими работами; письменные критерии главным образом про помещение/зоны/слои/оборудование, а не обязательный wall CAD | Перенести после Q02/E01/I01 и двух подтверждённых дефектов. Делать только если в demo-script реально нужен этот жест | 2–5 ч + regression risk | U03 | обязательные критерии и demo полностью закрыты раньше; затем — optional wall/opening creation |
| **Q02 ещё не имеет измеренного benchmark** | **Критически оспариваю готовность, не архитектуру** | **DOC:** `CURRENT_CONTEXT.md:21`, HANDOFF Q02 | Сделать реальный harness 100/500/1000 и сохранить raw/results metadata | 3–5 ч | Q02/E02 | commit/browser/machine/repeats + p50/p95; никаких оценочных чисел в README |
| **I01 существует в MR, но не интегрирован** | **Критический release blocker** | **DOC:** `CURRENT_CONTEXT.md:22`; код ветки отсутствует в архиве | Reviewer → integrator → public smoke. Не считать деплой готовым до URL-проверки без локального окружения | 1–3 ч + hosting unknown | I01/Q01/E02 | публичный URL без аккаунта; SPA reload; `/api/health`; fallback; секретов в frontend нет |
| **README/матрица требований считаются доказательством воспроизводимости** | **Согласен, но документы сейчас несогласованы** | **STATIC/DOC:** README сверху всё ещё говорит, что layers/properties/3D не готовы; `docs/tz-compliance.md` содержит дубли Р1/Р2/Р3 с разными статусами | E02 должен удалить устаревшие статусы и дубликаты, а не просто дописать конец файла | 1–2 ч | E02 | новый участник по README поднимает приложение; один актуальный status; compliance без противоречащих строк |
| **Spatial index / worker пока не введены** | **Согласен** | первый отчёт рекомендовал сначала benchmark; architecture говорит то же | Не добавлять до Q02. Только если profiler покажет geometry bottleneck | Ноль сейчас | Q02/G01/G03 | решение основано на измерении, а не на размере кода |

---

# 2. Подтверждённые дефекты и гипотезы

## 2.1. Подтверждено статическим анализом приложенного кода

### P0 — конфликт восстановления черновика с `Новый` / `Открыть`

`src/features/files/FileControls.tsx`:

- draft writer намеренно не пишет, пока `offered !== null`;
- обработчики `Новый` и `Открыть` не снимают `offered`;
- `restore(offered)` остаётся доступным после замены документа;
- следовательно старое предложение может позднее заменить только что созданный/открытый документ.

Это не только косметика: это **риск потери/подмены пользовательского состояния** в критерии загрузки/сохранения 15%.

### P0/P1 — 3D игнорирует `layer.visible`

`src/features/view3d/scene.ts:buildScene()` включает все `zones` и `objects`. У сущностей есть `layerId`, у `Layer` есть `visible`, но фильтрации нет. Значит выключение слоя в 2D не гарантирует эквивалентное представление в 3D.

### P1 — WebGL probe создаёт контекст без освобождения

`View3D.tsx:webglAvailable()` делает `canvas.getContext('webgl2') ?? ...` и просто возвращает boolean. Сам основной renderer на unmount освобождается хорошо (`dispose()` + `forceContextLoss()`), но probe — нет. Это особенно неприятно при многократном переключении вида перед жюри.

### P1 — нет обработки `webglcontextlost`

`View3DCanvas.tsx` имеет error boundary для исключений при создании/render, но не listener на `webglcontextlost`. Реальная потеря контекста может дать пустой/чёрный canvas вместо честного fallback.

### P1 — документы расходятся с состоянием продукта

- `README.md` верхнего уровня говорит, что layers/properties/3D ещё не готовы, хотя более свежие HANDOFF/исходники говорят обратное.
- `docs/tz-compliance.md` содержит по две строки Р1/Р2/Р3 с разными статусами.

Это не ломает приложение, но напрямую бьёт по 10% за воспроизводимость/README и создаёт плохое первое впечатление при проверке репозитория.

## 2.2. Не считать подтверждённым без запуска

Следующее пока только **RUN REQUIRED**:

- реальные p50/p95 на 100/500/1000;
- отсутствие лагов drag/zoom на конкретной demo-машине;
- итоговая корректность всего Q01 после слияния дальнейших MR;
- публичный деплой и reload SPA;
- живой LLM request и действующий balance/quota;
- фактический UX A06: насколько заметно зрителю, что именно добавила модель;
- поведение U04 Escape/resize offset/locked-delete из ревью HANDOFF, потому что соответствующие исходники в пакет не включены;
- параллельная изоляция e2e worktrees в полном tooling;
- все 384 unit и 41 e2e из HANDOFF — это **project-reported evidence**, не мой прогон.

---

# 3. Backlog до вечера 21.09

## 3.1. Обязательное

### 1. Исправить IO03 draft-state bug и закрыть browser test
**Почему:** подтверждённый data-loss/state-replacement риск.  
**Gate:** draft → открыть другой файл → старый draft не может неожиданно заменить открытый план.

### 2. Довести D01 до безопасного demo-state
Исправить:
- `layer.visible`;
- WebGL probe cleanup;
- `webglcontextlost`.

**Gate:** hide layer → 3D parity; stress toggle; graceful lost-context.

### 3. Выполнить реальный smoke одного LLM-провайдера
Не четырёх. Приоритет — тот, для которого **у команды уже есть рабочий account/key/balance**.

**Gate:**
- 200/valid body;
- точный model ID записан;
- `mode=llm`;
- тот же сценарий без ключа даёт `mode=fallback`;
- никакого ключа в логах/repo.

### 4. Q01 — один чистый сквозной прогон релиз-кандидата
Нужен именно **release flow**, а не сумма модульных тестов:

`fresh browser → создать план → открыть готовый → изменить → validation → assistant → before/after → 3D → save → reopen downloaded file`.

### 5. Q02 — измерение масштабируемости
Минимум 100 / 500 / 1000 объектов, фиксированный seed.

Записывать:
- commit;
- browser/version;
- машина/CPU/RAM;
- repeat count;
- initial load;
- selection/command;
- full validation;
- save/reopen;
- p50/p95.

Не публиковать «цель <100 ms» как результат.

### 6. E01 — собственные source/after + recommendation + ZIP
Оба plan-файла должны открываться в fresh profile и оставаться редактируемыми.

Рекомендуемый manifest:
- `source.plan.json`
- `after.plan.json`
- `assistant-recommendation.json`
- `README-open.txt`
- `manifest.json`

### 7. I01 — интегрировать и проверить публичный деплой
MR сам по себе не доказательство.

Минимальный smoke извне:
- URL без login;
- hard reload на route;
- открыть встроенный/скачанный demo;
- `/api/health`;
- fallback при выключенном LLM;
- HTTPS/secret check.

### 8. E02 — переписать верх README как release README
Не косметическая «актуализация статуса», а один рабочий путь проверки:
- что умеет;
- URL;
- `npm ci / dev / serve / tests`;
- формат demo files;
- ограничения;
- benchmark facts;
- AI provenance/fallback;
- лицензии/внешние зависимости.

И удалить устаревшие/дублированные строки compliance.

## 3.2. Высокий эффект при малой цене

### A. Сделать вклад LLM наблюдаемым без ослабления trust boundary
Если A06 сейчас просто показывает одинаковый шаблон и badge `LLM`, зрителю может быть непонятно, зачем модель вообще нужна.

Дешёвый UX:
- «Модель выбрала вариант `candidate_2` из 3 рассчитанных»;
- «Основание: `reasonCode`, факты `fact_…`»;
- рядом — «числа рассчитаны кодом и проверены».

Это усиливает AI-критерий, не давая LLM свободно сочинять числа.

### B. Один «proof drawer» для рекомендации
Показывать:
- IDs;
- rule source;
- assumptions;
- before/after/delta;
- статус `LLM verified` или `Без LLM`.

Если уже есть — не кодировать заново, включить в demo-script.

### C. Изоляция e2e-портов для worktrees
Если параллельная разработка продолжается, маленькая tooling-правка окупается сразу: меньше ложных зелёных/красных прогонов.

### D. Проверить «новый тип без кода» прямо в демо-файле
Это очень наглядное доказательство 20% model/extensibility и почти не требует нового кода.

## 3.3. Отложить

До закрытия обязательного выше **не делать**:

- миграцию с Konva;
- новый state framework;
- RAG/agent framework;
- spatial index/worker без benchmark;
- четыре production LLM adapters;
- автоматическую перестановку;
- live collaboration;
- серверную БД проектов;
- фотореалистичный 3D;
- клик-селекцию в 3D;
- отдельный SVG engine;
- продвинутый export image pipeline;
- создание новых перегородок/проёмов как P0-функцию.

Инструменты «Перегородка»/«Проём» можно вернуть в работу после Q02/E01/I01, если команда сохраняет запас и считает их важными для собственного demo-story.

---

# 4. Следующие 4 часа — пять независимых ролей

Ниже **роли**, не назначения людям.

## Роль A — File safety / Q01 slice

**Файлы:**  
`src/features/files/FileControls.tsx`, соответствующий `tests/e2e/files.spec.ts` / unit tests полного repo.

**0–90 мин**
- воспроизвести сценарий draft → Open;
- исправить lifecycle `offered`;
- добавить тесты на Open/New/Restore.

**90–180 мин**
- прогнать file-only + editor e2e в изолированном dev server;
- подготовить маленький MR.

**180–240 мин**
- после merge пройти clean-profile save/reopen slice.

**Не трогает:** 3D, AI, perf scripts.

---

## Роль B — 3D hardening

**Файлы:**  
`src/features/view3d/scene.ts`, `View3D.tsx`, `View3DCanvas.tsx`, `scene.test.ts`, browser 3D spec.

**0–120 мин**
- visibility filter по `layerId`;
- безопасный WebGL probe cleanup;
- `webglcontextlost`/fallback.

**120–180 мин**
- tests: hidden layer parity + repeated toggle + context loss.

**180–240 мин**
- интеграционный smoke после merge.

**Контракт:** не меняет `PlanDocument`.

---

## Роль C — AI production smoke

**Файлы:**  
в идеале только server config/tests/docs env; секреты **не коммитятся**.

**0–45 мин**
- выбрать provider, для которого есть account/key/balance;
- сверить endpoint/model по документации.

**45–90 мин**
- `server/llm-smoke.test.ts` с env;
- записать status/model/latency как evidence без key.

**90–150 мин**
- прогнать реальный `/api/advice`;
- отдельно timeout/invalid-key или выключенный key → fallback.

**150–240 мин**
- проверить A06 в браузере: виден ли вклад модели;
- если нет — маленький UI/provenance patch, не свободный текст.

**Dependency:** человеческий key/balance. Без него роль за 30 минут фиксирует blocker и переключается на release evidence.

---

## Роль D — Performance / Q02

**Файлы:**  
`tests/perf/*`, `scripts/*`, `docs/verification/performance.md` — один владелец.

**0–60 мин**
- генератор fixed-seed 100/500/1000;
- определить метрики и repeat count.

**60–180 мин**
- настоящий browser run;
- raw samples + p50/p95;
- профилирование только если есть явный bottleneck.

**180–240 мин**
- записать commit/browser/machine;
- решить: нужен ли bbox/spatial index/worker. По умолчанию — нет.

**Не трогает:** production geometry до появления измеренного дефекта.

---

## Роль E — Release / demo / deploy integration

**Файлы:**  
I01 branch/release config; `demo/*`; release-section README — **единственный владелец этих общих артефактов**.

**0–60 мин**
- review I01;
- определить реальный hosting target;
- поднять staging/public URL.

**60–150 мин**
- начать E01 source/after/manifest;
- открыть оба в clean browser.

**150–210 мин**
- public smoke;
- собрать факты/скриншоты для PDF.

**210–240 мин**
- integration checkpoint пяти ролей;
- обновить release blockers;
- только после этого править верх README.

---

## Порядок интеграции

1. IO03 bugfix — независимо.
2. D01 hardening — независимо.
3. AI smoke/config — независимо; production code меняется только если требуется.
4. Q02 не ждёт 1–3, но финальные числа снимаются на merged release candidate.
5. I01 может merge раньше; финальный public smoke — после 1–3.
6. E01/Q01 — после 1–3.
7. E02 — последним, по **фактическому** состоянию и измерениям.

За 4 часа не открывать новый большой feature branch, пока эти пять потоков не дали наблюдаемый результат.

---

# 5. Пятиминутный demo-script

## 0:00–0:30 — два входа
Показать:
- «Новый план»;
- «Открыть готовый».

На 5–10 секунд создать пустой контур, затем открыть **собственный source plan**, не organizer example как финальный demo.

**Доказательство:** R1/R2/R13, 30% + 15%.

## 0:30–1:20 — редактор как инженерный инструмент
На готовом плане:
- zoom-to-cursor;
- выбрать объект;
- показать ID/тип/координаты/размер/угол;
- drag + rotate/resize;
- undo;
- layer visibility;
- один информационный слой («загрузка синтетическая»).

**Доказательство:** 30%.

## 1:20–2:00 — truth layer
Открыть validation:
- клик по проблеме;
- показать конкретный объект/зону;
- исправить одно нарушение;
- пересчёт исчезает.

Показать площади так, чтобы было очевидно: вложенные зоны не суммируются как 96.75 м² в 78 м² помещении.

**Доказательство:** 30% + 15%.

## 2:00–3:15 — ассистент
Сценарий «найти место»:
- код нашёл до трёх геометрически допустимых вариантов;
- показать candidate ID, координаты, эффект, assumptions;
- если LLM live: «модель выбрала этот вариант/причину из рассчитанных, вот fact IDs»;
- вручную внести изменение;
- scenario compare показывает before→after по free area/inventory.

Если LLM отключить/не доступна:
- тот же baseline остаётся;
- явная метка «Без LLM».

**Доказательство:** 20% AI + 20% model/inventory.

## 3:15–3:45 — связанная инвентаризация и расширяемость
Показать:
- объект в таблице инвентаризации;
- его zone/type;
- один пользовательский type/attribute из catalog/demo.

**Доказательство:** 20%.

## 3:45–4:15 — 3D
Переключить на 3D:
- то же положение/поворот/размер;
- скрытый 2D-layer не должен внезапно появиться;
- никаких отдельной кнопки «синхронизировать».

**Доказательство:** 5%.

## 4:15–4:45 — save/reopen
Скачать изменённый JSON → открыть его снова → выбрать тот же объект → показать, что ID/атрибут/положение/слой сохранены.

**Доказательство:** 15%.

## 4:45–5:00 — scalability + reproducibility
Не говорить «быстро». Показать одну строку реального Q02:
- `100/500/1000`;
- browser/machine;
- p50/p95.

И открыть README/URL/ZIP manifest.

**Доказательство:** 30% scalability + 10% reproducibility.

---

# 6. Матрица доказательств по весам 30/20/20/15/10/5

| Вес | Что жюри должно увидеть | Артефакт-доказательство |
|---:|---|---|
| **30% 2D/масштабируемость** | точный drag/rotate/resize; zones/layers; zoom; validation highlight; info layers; measured 100/500/1000 | browser demo + Q02 raw/report |
| **20% модель/инвентарь/расширение** | один PlanDocument; catalog-driven type/attr; direct/inclusive inventory; изменение плана сразу меняет inventory | source/after plans + catalog example + UI |
| **20% AI** | три сценария; candidates рассчитаны кодом; LLM выбор проверен fact IDs; fallback без API | `/api/advice` evidence + assistant UI + recommendation JSON |
| **15% load/check/save** | organizer/source import; invalid file не портит текущий план; validation; save/reopen; draft safety | Q01 + files e2e + E01 |
| **10% README/repro** | public URL; clean start; exact commands; limitations; benchmark facts; secret policy | release README + deployment doc + CI |
| **5% 3D** | 3D всегда производен от current plan, respects visibility, degrades gracefully | D01 tests + live demo |

---

# 7. Что проект уже сделал лучше/жёстче первого эталона

Это важно не потерять при полировке.

1. **LLM trust boundary жёстче, чем минимально требовалось.**  
   Модель не может вставить произвольное число или предложение: `strict()` schema + referential/semantic checks.

2. **Вертикальная физика уже отделена от занятости пола.**  
   Это закрывает предметную ловушку «камера / принтер / стеллаж» лучше, чем простой 2D collision engine.

3. **Information layers стали типизированными catalog-driven представлениями.**  
   Это сильнее, чем просто checkbox-группы.

4. **3D scene сначала строится как чистые данные, Three.js — только renderer.**  
   Это хорошая тестируемая граница.

5. **Organizer example импортируется отдельным адаптером вместо превращения его формата в канонический.**  
   Это правильное решение для собственного versioned document.

Эти части не надо «улучшать» сменой фундаментальной архитектуры.

---

# 8. Неизвестные, которые команда действительно должна закрыть

## До 18–19.09

1. **Какой один LLM account реально оплачен и работает?**  
   Не «какие разрешены», а конкретно: provider / account / model / endpoint / balance / quota.

2. **Где будет public deployment и до какого момента URL обязан жить?**

3. **Какое точное время/часовой пояс сдачи 22.09?**

4. **Кто является release/integration owner на 20–22.09?**  
   Имена исследование не назначает; команда должна назначить сама.

## До feature freeze 20.09

5. **Каковы реальные Q02 p50/p95?**

6. **Есть ли в A06 визуально понятная разница между verified LLM path и fallback?**  
   Если нет, нужна дешёвая provenance-визуализация, а не более свободный LLM.

7. **Проходит ли public deployment clean-profile Q01?**

8. **Достаточен ли wall/opening edit без создания новых стен для выбранного demo-story?**  
   Если да — не тратить время. Если нет — вернуть U03 после release blockers.

9. **Какой именно source/after story пойдёт в ZIP и PDF?**  
   Он должен одновременно показывать validation, inventory и AI effect, а не быть тремя несвязанными примерами.

---

# 9. Ограничения этого второго прохода

## Нет полного кода

Архив специально содержит выбранные исходники. Поэтому я могу независимо подтвердить архитектурные границы и несколько конкретных дефектов, но не могу утверждать, что:

- все UI wiring соответствует документам;
- store/persistence/e2e infrastructure полностью корректны;
- все package boundaries фактически соблюдаются;
- все reported tests проходят на `main a25cbd7`.

## Нет живого запуска полного приложения

В этом проходе не выполнялись:
- `npm ci`;
- `npm test`;
- Playwright;
- `npm run build`;
- public deploy;
- browser performance benchmark.

Поэтому **384/384 + 1 skipped** и **41/41 e2e** остаются данными HANDOFF, а не моими результатами.

## Нет ключа LLM

Нельзя подтвердить:
- реальный доступ команды;
- balance/quota;
- latency;
- конкретный returned model;
- то, что текущий `LLM_ENDPOINT/LLM_MODEL` работает именно с аккаунтом команды.

Это остаётся P0 human smoke.

---

# 10. Веб-источники, сохранённые для PASS-2

Проверены 17.09.2026.

## Konva

- React Transformer: https://konvajs.org/docs/react/Transformer.html  
  Наблюдение: resize/rotate реализуются через `Transformer`; renderer-specific transform необходимо нормализовать в domain state.

## Polygon clipping

- `polyclip-ts` upstream: https://github.com/luizbarboza/polyclip-ts  
  Наблюдение: библиотека предоставляет `intersection`, `union`, `difference`, `xor`; использует Martinez-Rueda-Feito. Текущий проект применяет её ровно к области, для которой она предназначена. Это не отменяет project fixtures/tolerance tests.

## Three.js

- WebGLRenderer: https://threejs.org/docs/pages/WebGLRenderer.html  
  Наблюдение: `dispose()` освобождает GPU-related resources; `forceContextLoss()` существует для потери контекста.
- ExtrudeGeometry: https://threejs.org/docs/pages/ExtrudeGeometry.html  
  Наблюдение: библиотека непосредственно поддерживает extrusion 2D Shape, что соответствует текущему derived-3D подходу.

## DeepSeek

- JSON Output: https://api-docs.deepseek.com/guides/json_mode/  
- Chat Completions: https://api-docs.deepseek.com/api/create-chat-completion/  

Наблюдение: `response_format={"type":"json_object"}` поддерживается, но prompt должен явно требовать JSON; возможен пустой content edge case. Поэтому текущая локальная Zod/semantic validation и fallback обязательны.

## Qwen / Alibaba Model Studio

- Structured output: https://docs.modelstudio.console.alibabacloud.com/en/model-studio/qwen-structured-output  
- OpenAI-compatible Chat: https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions  

Наблюдение: JSON Object и часть JSON Schema режимов поддерживаются; endpoints/workspaces зависят от региона. Локальную проверку ответа оставлять независимо от provider-side schema.

## GigaChat

- API/auth: https://developers.sber.ru/docs/ru/gigachat/api/reference/rest/gigachat-api  
- Structured output: https://developers.sber.ru/docs/ru/gigachat/guides/structured-output  
- Quickstart для новых клиентов: https://developers.sber.ru/docs/ru/gigachat/individuals-quickstart  

Наблюдение: target API — `api.giga.chat`; structured output документирован, но auth/account path отличается от текущего простого Bearer API-key клиента. С 01.09.2026 для новых клиентов изменён путь оплаты. Это аргумент **не** писать адаптер без реально выбранного командой аккаунта.

## Yandex AI Studio

- OpenAI-compatible integration: https://yandex.cloud/en/docs/tutorials/ml-ai/ai-model-ide-integration  
- Current pricing: https://aistudio.yandex.ru/en/docs/ai-studio/pricing  

Наблюдение: AI Studio предоставляет OpenAI-compatible base URL, но model URI/auth/account должны быть проверены живым запросом команды. Не менять текущий клиент «на всякий случай».

---

# 11. Решение на ближайшие 4 часа в одной строке

**Пять потоков:** `IO03 safety` ∥ `D01 hardening` ∥ `live LLM smoke` ∥ `Q02 benchmark` ∥ `I01+E01 release`, затем один integration checkpoint и Q01; новые editor-features — только после этого.

Главная цель следующего окна — превратить уже сильную архитектуру из набора хорошо протестированных модулей в **один измеренный, публично доступный, повторяемый конкурсный сценарий**.
