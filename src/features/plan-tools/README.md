# src/features/plan-tools

Инструменты границы помещения, зон, стен и проёмов; их геометрический слой.

**Владелец:** поток 2. **Пакеты:** U03.
Реализовано пакетом U03 частично: `PlanGeometryLayer.tsx` рисует помещение, зоны, стены и проёмы, `use-plan-tool-controller.ts` рисует контур по точкам и замыкает кликом по первой, `PlanTools.tsx` — выбор инструмента. Правка вершин готовой зоны и смена родителя из интерфейса ещё не сделаны.

## Граница модуля

Потребляет contracts и geometry. Контроллер инструмента выдаёт Command, а не пишет в store. App передаёт события через ToolController.

## Файлы по плану

Следующие файлы создаются при реализации соответствующих пакетов:

- `PlanTools.tsx` — U03.
- `PlanGeometryLayer.tsx` — U03.
- `use-plan-tool-controller.ts` — U03.

**Проверки:** собственный browser harness в `tests/harness/<ID>.tsx`, spec в `tests/e2e/`; после подключения — общий Q01.

[Карта проекта и владельцы](../../../docs/project-structure.md) · [Контракты](../../../docs/contracts-v1.md) · [План задач](../../../docs/plans/2026-09-16-parallel-plan.md)
