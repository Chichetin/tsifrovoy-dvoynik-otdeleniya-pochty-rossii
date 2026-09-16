# src/state

Единый документ, revision, selection, dirty, baseline экспорта, undo/redo.

**Владелец:** поток 1. **Пакеты:** S01 — реализован.

`createPlanStore(document)` возвращает zustand-store с поверхностью `PlanStore` из
контрактов: `document`, `revision`, `selection`, `dirty` только для чтения,
правки — через `dispatch`. История, baseline экспорта и удалённые id лежат в
замыкании, поэтому наружу не протекают. UI подписывается через `useStore` из zustand;
синглтона нет — store создаёт `src/app`.

## Граница модуля

Потребляет contracts и domain/commands. Не импортирует UI, server и persistence; загрузку подключает app.

## Файлы по плану

Следующие файлы создаются при реализации соответствующих пакетов:

- `plan-store.ts` — S01.

**Проверки:** unit-тесты рядом с реализацией; публичные контракты и граничные случаи из карточки пакета.

[Карта проекта и владельцы](../../docs/project-structure.md) · [Контракты](../../docs/contracts-v1.md) · [План задач](../../docs/plans/2026-09-16-parallel-plan.md)
