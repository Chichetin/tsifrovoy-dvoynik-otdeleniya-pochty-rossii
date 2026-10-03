# tests

Тесты доменной логики, сквозной браузерный сценарий и замер производительности.

**Владелец:** поток 5.

Набор — минимум (`CLAUDE.md`, «Тесты», D-354). Unit-тест лежит рядом с модулем
(`*.test.ts`, `server/*.test.ts`); здесь — только тесты на несколько модулей сразу.

## Запуск

- `npm test` — unit-тесты, около 2 с.
- `npm run test:e2e` — браузерный сценарий (`e2e/README.md`).
- `npm run test:perf` — замер на 100, 500 и 1000 объектах (`perf/README.md`).

## Файлы

- `demo.test.ts` — демо-комплект: оба плана открываются, рекомендация и эффект
  совпадают с расчётом.
- `example-plan-checks.test.ts` — ловушки `example_plan.json`.
- `assistant-corpus/cases.ts` — планы для `scripts/check-assistant-live.ts`.
- `harness/` — стенд компонента: `npm run dev` → `/tests/harness/?id=<ID>`.

[Карта проекта и владельцы](../docs/project-structure.md) · [Контракты](../docs/contracts-v1.md)
