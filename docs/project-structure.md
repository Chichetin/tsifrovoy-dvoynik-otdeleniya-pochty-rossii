# Структура проекта и владельцы

Каталоги созданы в репозитории и сохраняются в Git через README модулей. Это физическая
основа согласованной архитектуры. Функции и запускаемый каркас реализуют задачи F01/F02
и следующие пакеты; наличие каталога не означает готовность модуля.

[Архитектура](architecture.md) · [Контракты](contracts-v1.md) ·
[34 задачи этапа 1](plans/2026-09-16-parallel-plan.md) · [Задачи этапа 2](plans/2026-09-28-stage2-backlog.md) · [Вопросы и итоги дня](../HANDOFF.md)

## Дерево каталогов

```text
.
├── src/
│   ├── app/                 # Композиция приложения и глобальные стили
│   ├── contracts/           # Типы, схемы, команды, UI/AI-контракты
│   │   └── fixtures/        # Эталонные данные для совместимости
│   ├── domain/              # Чистая общая логика браузера и сервера
│   │   ├── geometry/        # Геометрия и координаты
│   │   ├── relations/       # Связи объектов и зон
│   │   ├── metrics/         # Площади и свободный пол
│   │   ├── commands/        # Изменения документа
│   │   ├── validation/      # Проверки корректности
│   │   ├── catalog/         # Проверка справочников
│   │   ├── inventory/       # Подсчёт оборудования
│   │   └── advice/          # Расчёт и проверка рекомендаций
│   ├── state/              # Документ, revision, selection, undo/redo
│   ├── persistence/        # JSON, импорт, браузерный черновик
│   └── features/           # Независимые UI-модули
│       ├── editor/         # Холст, сетка, zoom/pan
│       ├── plan-tools/     # Комната, зоны, стены, проёмы
│       ├── equipment/      # Фигуры и жесты оборудования
│       ├── layers/         # Панель слоёв
│       ├── properties/     # Атрибуты и точный ввод
│       ├── library/        # Выбор оборудования
│       ├── files/          # Открытие и скачивание
│       ├── inventory/      # Таблица и метрики
│       ├── validation/     # Диагностика и подсветка
│       ├── assistant/      # Рекомендации и before/after
│       └── view3d/         # Условная 3D-сцена
├── server/                 # HTTP и внешний LLM; серверные env
├── data/
│   └── catalog/            # Расширяемые JSON-справочники
├── tests/
│   ├── e2e/                # Пользовательские и модульные browser-сценарии
│   ├── harness/            # Изолированная приёмка UI
│   └── perf/               # Измерения производительности
├── scripts/                # Упаковка демо и генерация нагрузочных планов
├── demo/                   # Собственные планы before/after и рекомендация
└── docs/
    ├── plans/              # План и карточки задач
    ├── research/           # Задание и будущий независимый отчёт
    └── verification/       # Команды, результаты и доказательства
```

README каждого каталога описывает назначение, владельца, границу и будущие файлы.
Пустых TypeScript-файлов, фиктивных JSON-данных и собственных package.json по каталогам
нет. Будет один корневой manifest/lockfile; src/domain используется и клиентом, и сервером.

## Пять потоков

Номер — слот команды, не выдуманное имя участника. Поток = метка `area:` в GitLab Issues
(1 — `area:model`, 2 — `area:editor`, 3 — `area:panels`, 4 — `area:assistant`,
5 — `area:release`); фактический исполнитель — assignee задачи (D-298).

| Поток | Ответственность | Первые пакеты |
|---|---|---|
| 1 | Модель, контракты, геометрия, состояние, проверки | F02 → G01/G02/G03 → S01/V01 |
| 2 | UX, композиция приложения, 2D-редактор и инструменты | U01/U02 → U03–U07 |
| 3 | Каталоги, сохранение, инвентаризация, отображение ошибок, 3D | C01/IO01/IO02/M01 → IO03/M02/V02/D01 |
| 4 | Расчёт рекомендаций, проверка ответа, сервер и панель AI | A01/A02/A04 → A03/A05/A06 |
| 5 | Каркас, зависимости, CI/деплой, QA, производительность, демо и сдача | F01/I01/Q01 → Q02/E01/E02; R01 отдельно |

## Карта владения каталогами

Вложенная строка уточняет владельца родительской. Например, domain — зона координации
потока 1, но domain/catalog принадлежит потоку 3, domain/advice — потоку 4.
В общих тестовых каталогах инфраструктурой владеет поток 5, а spec/harness модуля —
владелец его пакета. Пути файлов закреплены в плане, это не совместное редактирование файла.

| Каталог | Поток | Пакеты |
|---|---|---|
| [src](../src/README.md) | 5 | F01 |
| [src/app](../src/app/README.md) | 2 | U01 |
| [src/contracts](../src/contracts/README.md) | 1 | F02 |
| [src/contracts/fixtures](../src/contracts/fixtures/README.md) | 1 | F02 |
| [src/domain](../src/domain/README.md) | 1 | G01 G02 G03 S01 V01 C01 M01 A01 A02 A03 A04 |
| [src/domain/geometry](../src/domain/geometry/README.md) | 1 | G01 |
| [src/domain/relations](../src/domain/relations/README.md) | 1 | G02 |
| [src/domain/metrics](../src/domain/metrics/README.md) | 1 | G03 |
| [src/domain/commands](../src/domain/commands/README.md) | 1 | S01 |
| [src/domain/validation](../src/domain/validation/README.md) | 1 | V01 |
| [src/domain/catalog](../src/domain/catalog/README.md) | 3 | C01 |
| [src/domain/inventory](../src/domain/inventory/README.md) | 3 | M01 |
| [src/domain/advice](../src/domain/advice/README.md) | 4 | A01 A02 A03 A04 |
| [src/state](../src/state/README.md) | 1 | S01 |
| [src/persistence](../src/persistence/README.md) | 3 | IO01 IO02 IO03 |
| [src/features](../src/features/README.md) | 2 | U01 U02 U03 U04 U05 U06 U07 IO03 M02 V02 A06 D01 |
| [src/features/editor](../src/features/editor/README.md) | 2 | U02 |
| [src/features/plan-tools](../src/features/plan-tools/README.md) | 2 | U03 |
| [src/features/equipment](../src/features/equipment/README.md) | 2 | U04 |
| [src/features/layers](../src/features/layers/README.md) | 2 | U05 |
| [src/features/properties](../src/features/properties/README.md) | 2 | U06 |
| [src/features/library](../src/features/library/README.md) | 2 | U07 |
| [src/features/catalog-editor](../src/features/catalog-editor/README.md) | 3 | C01 U07 |
| [src/features/files](../src/features/files/README.md) | 3 | IO03 |
| [src/features/inventory](../src/features/inventory/README.md) | 3 | M02 |
| [src/features/validation](../src/features/validation/README.md) | 3 | V02 |
| [src/features/view3d](../src/features/view3d/README.md) | 3 | D01 |
| [src/features/assistant](../src/features/assistant/README.md) | 4 | A06 |
| [server](../server/README.md) | 4 | A05 |
| [data](../data/README.md) | 3 | C01 |
| [data/catalog](../data/catalog/README.md) | 3 | C01 |
| [tests](../tests/README.md) | 5 | F01 Q01 Q02 E01 |
| [tests/e2e](../tests/e2e/README.md) | 5 | Q01 |
| [tests/harness](../tests/harness/README.md) | 5 | F01 |
| [tests/perf](../tests/perf/README.md) | 5 | Q02 |
| [scripts](../scripts/README.md) | 5 | Q02 E01 |
| [demo](../demo/README.md) | 5 | E01 |
| [docs](README.md) | 5 — координация; владельцы пакетов пишут свои материалы | E02 и все пакеты |
| [docs/plans](plans/README.md) | 5 — координация | План 34 задач |
| [docs/research](research/README.md) | 5 | R01 |
| [docs/verification](verification/README.md) | 5 — координация | Q01 Q02 E02 |

## Зависимости и правила импортов

| Откуда | Куда разрешено | Граница |
|---|---|---|
| contracts | Библиотека схем; type-only UI-типы в ui.ts | Никаких реализаций проекта |
| domain | contracts, публичные функции других domain-модулей по DAG плана, математические библиотеки | Ни React, ни IO; без циклов между модулями |
| state | contracts, domain/commands | Не знает о UI/сохранении/сервере |
| persistence | contracts, domain/catalog/geometry/relations при импорте, domain/commands для слияния справочников (D-148) | DOM только в browser-draft; никакого store |
| features | contracts, нужные domain/persistence-модули и UI-библиотеки | Без импортов соседних features, app, state и server |
| app | contracts, state, features, persistence, domain, начальные data/catalog | Единственная композиция и подключение производных расчётов |
| server | contracts (кроме ui.ts), domain, серверные библиотеки | Не импортирует клиентское состояние/DOM; ключ не попадает в src |
| tests/scripts | Публичные интерфейсы нужных модулей и fixtures | Production не импортирует tests/scripts |

Зависимости пока описаны, **не проверяются линтером**: настройка ограничения импортов
и раздельной сборки client/server входит в F01. Public API domain-модуля — его локальный
index.ts; у advice существующий index.ts принадлежит A03, остальные агенты его не правят.
Не создавать общий src/index.ts или папку utils/shared для несвязанных функций.
Общая UI-кнопка извлекается, когда появятся реальные потребители, отдельным согласованным
изменением; для каждой будущей абстракции не резервируем пустой каталог.

## Файлы, которые остаются в корне

- CLAUDE.md, AGENTS.md, GIT.md, HANDOFF.md — существующие правила и доска.
- task.md, example_plan.json, PDF оборудования — исходные материалы; не перемещаем,
  чтобы сохранить ссылки правил, контракты импорта и тесты примера.
- README.md — короткий вход в проект и далее реальная инструкция запуска/проверки.
- package.json, lockfile, TypeScript/Vite/test-конфиги, index.html — создаёт F01.
- Dockerfile, compose.yaml, .dockerignore, .gitlab-ci.yml — создаёт I01 в корне.
- .env.example — создаёт A05; .env остаётся локальным и игнорируется.

Корневым tooling владеет поток 5. .env.example/серверной конфигурацией — поток 4.
Глобальными стилями и app — поток 2. Общими контрактами и fixtures — поток 1.
Строки общей документации каждый пакет готовит в своём MR по правилам проекта,
поток 5 координирует слияние. GitLab CODEOWNERS с фиктивными аккаунтами не создаём:
сейчас роли зафиксированы здесь, реальные аккаунты можно подключить после назначения.

## Как начать пакет

1. Прочитать CLAUDE.md, GIT.md, HANDOFF.md и карточку своего ID в плане.
2. Взять задачу (`bash scripts/issues.sh take <N>`) и создать worktree `<N>-<тема>` от origin/main.
3. Открыть README своего модуля и общий contracts-v1; не копировать общие типы в модуль.
4. После F01/F02 писать реализацию и её тесты в закреплённых файлах. UI можно принимать
   через собственный harness до подключения к app.
5. Изменение контракта или общего файла сначала согласовать с его владельцем.
6. Перед MR прогнать проверки и хуки; интегратор подключает UI и проходит общий Q01.

Каталоги созданы для начала параллельной разработки. F01 ещё должен сделать чистую
установку и запуск, F02 — реальные схемы/fixtures. Стадия не закрывает продуктовые
требования и не заменяет браузерный сценарий редактора.
