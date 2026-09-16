# HANDOFF.md — доска текущей работы

Отвечает только на вопросы «кто что делает сейчас», «что нельзя трогать» и «как
принять результат». История — в Git, решения — в `docs/decisions.md`.

## Правила

- Перед нетривиальной задачей добавить строку в «Активные задачи» (в своей ветке —
  строка появится в `main` вместе с первым MR; ссылку на MR вписать сразу).
- У файла или контракта в каждый момент один владелец.
- При завершении указать MR, commit, проверку и известные ограничения, перенести строку
  в «Завершено».
- Если работа локальная и не запушена — писать явно.

## Активные задачи

| Владелец | Ветка / MR | Задача | Файлы/контракт | Проверка | Статус |
|---|---|---|---|---|---|
| Claude Code (поток 5) | `worktree-infra-f01-scaffold`, [MR !4](https://git.codenrock.com/codenrock/khakaton-postcode-challenge-ot-pochtatekha/ii-blanki/tsifrovoy-dvoynik-otdeleniya-pochty-rossii/-/merge_requests/4) | F01 — каркас, версии, команды, границы импортов; правила интеграции пяти потоков в `CLAUDE.md` | `package.json`, lockfile, конфиги TS/Vite/Vitest/Playwright/ESLint, `index.html`, `src/main.tsx`, `src/app/App.tsx` (до U01), `tests/harness/`, `tests/smoke.test.tsx`, `tests/e2e/smoke.spec.ts`, `CLAUDE.md` | `npm ci && npm test && npm run typecheck && npm run lint && npm run build && npm run test:e2e` — зелёные | на ревью: нужен второй участник (правила и tooling) |
| Claude Code (поток 1) | `worktree-model-contracts`, MR см. ниже | F02 — контракты и fixtures: оси и поворот, вложенность зон, слои, версия формата | `src/contracts/*`, 7 fixtures, `docs/decisions.md` D-010…D-014, матрица М1/М2/П1/П7 | `npm test` 18/18, `npm run typecheck`, `npm run lint`, `npm run build` — зелёные | готово, ждёт ревью второго участника (контрактный MR) |

| Claude Code (поток 2) | `worktree-geometry-core`, MR см. ниже | G01 — базовая геометрия и координаты | `src/domain/geometry/*` | `npm test` 40/40, typecheck/lint/build зелёные | готово, ждёт ревью |

## Блокеры и вопросы

| Дата | Владелец | Блокер | Что проверено | Что нужно |
|---|---|---|---|---|
| 2026-09-16 | человек | Где хостить сервис для проверки и до какой даты он должен работать | `task.md` — не указано | ответ организаторов |
| 2026-09-16 | человек | Время и часовой пояс дедлайна 22.09 | со слов организаторов — только дата | ответ организаторов |
| 2026-09-16 | человек | Ключи API Qwen / DeepSeek и оплата из РФ | — | получить ключ, проверить один запрос |
| 2026-09-16 | поток 2 → владелец F01 | Для G03 нужен `polygon-clipping`: union отпечатков без него не посчитать. В `package.json` его нет | G01 обошёлся без булевых операций; проверено `node -e` по `package.json` | владелец F01 добавляет зависимость точной версией, остальные её не правят |
| 2026-09-16 | человек | Агент не может мержить MR сам: токен пускает в git, но не в API | `/api/v4/user` → 401; push options создают MR (MR !1) | токен со scope `api` или разрешение проверить автомерж push option |

## Завершено

| Дата | Кто | Что | MR / Commit | Проверка |
|---|---|---|---|---|
| 2026-09-16 | Claude Code | Правила проекта, хуки, `jury`, `submission-checklist`, матрица условий, решения D-001…D-004 | MR !1 | `test-hooks.sh` 26/26; `check-secrets.sh` чисто; MR создан push options |
| 2026-09-16 | Codex | Архитектура и контракты v1, 34 пакета на 5 разработчиков с агентами, высокая планка UX/AI/качества, независимый Deep Research | [MR !2](https://git.codenrock.com/codenrock/khakaton-postcode-challenge-ot-pochtatekha/ii-blanki/tsifrovoy-dvoynik-otdeleniya-pochty-rossii/-/merge_requests/2), `21df0d1`; ветка `worktree-docs-architecture`; сначала влить MR !1 | 34 пакета, 50 обязательных требований, DAG без циклов, ссылки; hooks 26/26; ревью учтено; отчёт `docs/verification/architecture.md`. Только проектирование: приложения и браузерного прогона ещё нет. Первые задачи реализации — F01/F02, предложения по стеку/контрактам в `docs/architecture.md` и `docs/contracts-v1.md` |
| 2026-09-16 | Codex | Созданы каталоги архитектуры: 36 модулей с README/владельцами, карта docs/project-structure.md, вход для сокомандника в README | [MR !3](https://git.codenrock.com/codenrock/khakaton-postcode-challenge-ot-pochtatekha/ii-blanki/tsifrovoy-dvoynik-otdeleniya-pochty-rossii/-/merge_requests/3), `c7fb731`; ветка `worktree-infra-layout` | Каталоги для 90 путей плана, ссылки корректны, hooks 26/26, независимое ревью; docs/verification/layout.md. После merge сокомандник начинает F01/F02 по плану; код приложения ещё не реализован |
| 2026-09-16 | Claude Code | F02 — контракты v1 в коде: `model/commands/advice/advice-semantics/ui/schema`, 7 фикстур, словарь допустимости объяснений; решения D-010…D-014 | ветка `worktree-model-contracts` | `npm test` 18/18 (17 контрактных + smoke), typecheck/lint/build зелёные. Реализации домена ещё нет: схема принимает геометрически неверный план намеренно (D-013), round-trip за IO01 |
| 2026-09-16 | Claude Code | G01 — геометрия: площади, отпечаток поворота, полное вложение для вогнутых зон, пересечения с учётом высоты, стены с проёмами, model↔screen | ветка `worktree-geometry-core` | `npm test` 40/40. Найден и закрыт тестом дефект: выровненные по стороне прямоугольники не определялись как пересекающиеся. Булевых операций нет — union отпечатков за G03 |
