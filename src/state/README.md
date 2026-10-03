# src/state

Единый документ, revision, selection, dirty, baseline экспорта/сравнения, undo/redo.

**Владелец:** поток 1. **Пакеты:** S01 — реализован.

## Граница модуля

Потребляет contracts и domain/commands. Не импортирует UI, server и persistence; загрузку подключает app.

[Карта проекта и владельцы](../../docs/project-structure.md) · [Контракты](../../docs/contracts-v1.md)
