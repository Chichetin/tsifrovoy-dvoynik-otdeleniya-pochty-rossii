# src/contracts

Общие типы, схемы входных данных, команды, UI-протокол и словарь фактов/объяснений.

**Владелец:** поток 1. **Пакеты:** F02.

## Граница модуля

Никаких импортов реализации из domain, state, features, persistence или server. React-типы разрешены только в ui.ts; server/domain не импортируют ui.ts.

[Карта проекта и владельцы](../../docs/project-structure.md) · [Контракты](../../docs/contracts-v1.md)
