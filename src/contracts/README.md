# src/contracts

Общие типы, схемы входных данных, команды, UI-протокол и словарь фактов/объяснений.

**Владелец:** поток 1. **Пакеты:** F02.

## Граница модуля

Никаких импортов реализации из domain, state, features, persistence или server. React-типы разрешены только в ui.ts; server/domain не импортируют ui.ts.

Имена знаков плана — `PLAN_PICTOGRAM_NAMES` в model.ts, поле `ObjectType.pictogram` (D-376). Рисунок знака — в `src/domain/plan-pictogram.ts`.

События режима Б «Предложить место» — `SUGGEST_PLACE_EVENT`, `SUGGESTION_GHOST_EVENT` и их `detail` в mode-b-events.ts (D-379). Имена событий в features не пишем.

[Карта проекта и владельцы](../../docs/project-structure.md) · [Контракты](../../docs/contracts-v1.md)
