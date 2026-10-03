# server

HTTP API, серверная конфигурация, клиент Qwen/DeepSeek, раздача собранного SPA.

**Владелец:** поток 4. **Пакеты:** A05.

## Граница модуля

Потребляет общие contracts/domain. Не импортирует React, state, features или browser-draft; не дублирует формулы. Deployment-конфигурация принадлежит потоку 5.

[Карта проекта и владельцы](../docs/project-structure.md) · [Контракты](../docs/contracts-v1.md)
