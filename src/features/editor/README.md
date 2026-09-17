# src/features/editor

Холст, сетка, zoom/pan, выбор, focus и перевод pointer в мировые координаты.

**Владелец:** поток 2. **Пакеты:** U02.
Реализовано пакетом U02: `viewport.ts` — чистая арифметика pan/zoom/вписывания (zoom держит точку под курсором), `EditorCanvas.tsx` — сетка, перевод pointer в метры и слои фигур через children. Фигуры здесь не рисуются.

## Граница модуля

Потребляет contracts, geometry и Konva. Принимает figures через children; бизнес-логику инструментов получает через callbacks.

## Файлы по плану

Следующие файлы создаются при реализации соответствующих пакетов:

- `EditorCanvas.tsx` — U02.
- `viewport.ts` — U02.

**Проверки:** собственный browser harness в `tests/harness/<ID>.tsx`, spec в `tests/e2e/`; после подключения — общий Q01.

[Карта проекта и владельцы](../../../docs/project-structure.md) · [Контракты](../../../docs/contracts-v1.md) · [План задач](../../../docs/plans/2026-09-16-parallel-plan.md)
