# src/domain/validation

Диагностика ID, связей, границ, коллизий и правил расстояния.

**Владелец:** поток 1. **Пакеты:** V01.

## Граница модуля

Потребляет contracts, geometry, relations, catalog и вычисление наружных стен из commands. Возвращает Issue[], не исправляет план молча.

`validatePlan(plan, today?)`: `today` — день «ГГГГ-ММ-ДД» для правила срока ТО (`maintenance.ts`, атрибут `nextMaintenanceDate`). Без параметра — сегодня по часам. Находки: `MAINTENANCE_OVERDUE`, `MAINTENANCE_DUE_SOON` (≤ 14 дн.), `MAINTENANCE_DATE_INVALID`.

`planHealth(issues)` (`health.ts`, #125): балл 0–100 = 100 минус штрафы находок, не меньше 0. Штраф — по серьёзности (`SEVERITY_PENALTY`: ошибка 10, предупреждение 3). В схеме правила справочника нет поля веса, поэтому веса в коде. Разбор — строки по коду и правилу; сумма штрафов = 100 − балл, если балл не обрезан нулём.

[Карта проекта и владельцы](../../../docs/project-structure.md) · [Контракты](../../../docs/contracts-v1.md)
