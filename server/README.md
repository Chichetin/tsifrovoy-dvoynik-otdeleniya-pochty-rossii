# server

HTTP API, серверная конфигурация, клиент Qwen/DeepSeek, раздача собранного SPA.

**Владелец:** поток 4. **Пакеты:** A05.
`GET /api/health` → `{status, llm: {configured, provider?}}` — без ключа (D-200). `llm-client.ts` — OpenAI-совместимый запрос; пустой `content` (рассуждающая модель исчерпала `max_tokens`) — отказ `LLM_EMPTY_CONTENT` с советом поднять `LLM_MAX_OUTPUT_TOKENS`; `llm-client.test.ts` — на подставном `fetch`.

## Граница модуля

Потребляет общие contracts/domain. Не импортирует React, state, features или browser-draft; не дублирует формулы. Deployment-конфигурация принадлежит потоку 5.

## Файлы по плану

Следующие файлы создаются при реализации соответствующих пакетов:

- `main.ts` — A05; там же `stopOnSignals` — остановка по `SIGTERM`/`SIGINT` с доведением запросов в полёте (D-203), тест `main.test.ts`.
- `advice-route.ts` — A05.
- `agent.ts`, `agent-route.ts` — агент по плану (D-255): цикл «модель → инструменты → проверка текста» и NDJSON-поток `POST /api/assistant/agent`; `createLlmChat` в `llm-client.ts` — вызов с `tools`.
- `llm-client.ts` — A05.
- `config.ts` — A05.

**Проверки:** unit-тесты рядом с реализацией; публичные контракты и граничные случаи из карточки пакета.

[Карта проекта и владельцы](../docs/project-structure.md) · [Контракты](../docs/contracts-v1.md) · [План задач](../docs/plans/2026-09-16-parallel-plan.md)
