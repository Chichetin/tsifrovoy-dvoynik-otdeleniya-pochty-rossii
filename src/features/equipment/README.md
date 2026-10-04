# src/features/equipment

Фигуры оборудования, создание экземпляра, перемещение/поворот и preview рекомендации.

**Владелец:** поток 2. **Пакеты:** U04, U07.

## Граница модуля

Потребляет contracts и geometry. Одна команда на завершённый жест; preview не добавляет объект в документ. Указатель переводится в метры только через `screenToModel` из `src/domain/geometry`; вся арифметика жестов — чистые функции `transform.ts` (D-075…D-078).

Силуэт ставимого типа (#26): `placement-ghost.ts` считает объект клика (`placedObject`) и отказ хранилища (`placementRefusal` — `applyCommand` и `editRejection`, как в `plan-store`); `PlacementGhostLayer` рисует его, App кладёт слой в `overlay`.

[Карта проекта и владельцы](../../../docs/project-structure.md) · [Контракты](../../../docs/contracts-v1.md)
