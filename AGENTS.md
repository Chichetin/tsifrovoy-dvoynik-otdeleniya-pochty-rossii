# AGENTS.md — правила для coding agents

Перед любой работой **полностью прочитать `CLAUDE.md`** — это канонический набор
правил проекта. Затем `GIT.md`, свою задачу в GitLab Issues, `HANDOFF.md` и относящиеся к задаче документы из
`docs/`. Условия хакатона — `task.md`.

Краткий обязательный протокол:

1. Начать с `git fetch --prune && git status -sb`; не трогать чужие незакоммиченные
   изменения. Взять задачу: `bash scripts/issues.sh free` → `bash scripts/issues.sh take <N>`
   (занятую другим или чужую `area:` не брать). **Файлы менять только в своём worktree**,
   не в основной копии на `main`:
   `git worktree add .claude/worktrees/<N>-<тема> -b worktree-<N>-<тема> origin/main`.
2. **Push в `main` закрыт на сервере.** Результат — push своей ветки с Merge Request в
   `main` (`git push -u origin HEAD -o merge_request.create -o merge_request.target=main
   -o merge_request.description="Closes #<N>"`), merge — в GitLab (подробно — `GIT.md`, «Финиш»).
3. Нетривиальная работа без задачи — сначала завести задачу (`bash scripts/issues.sh create`,
   шаблон `.gitlab/issue_templates/Задача.md`): что меняем, чем проверим, что намеренно не
   трогаем. Риск показа или сдачи — задача с меткой `blocker`.
4. Проверять реальным запуском: тесты + сценарий в браузере «открыть → загрузить демо →
   изменить → сохранить → открыть заново». «Должно работать» — не результат.
5. Никаких секретов в репозитории: ключи LLM только в `.env`, в `.env.example` —
   плейсхолдеры.
6. LLM — только Qwen, DeepSeek, GigaChat или YandexGPT по API. Числа в рекомендациях считает код, модель
   только объясняет; ответ модели сверяется с расчётом.
7. Данные только синтетические; реальные планы и персональные данные не используются.
8. Продуктовое или техническое решение — строка в `docs/decisions.md`; закрытый пункт
   условий — строка в `docs/tz-compliance.md` в том же коммите.
9. Законченный проверенный шаг — отдельный коммит и push ветки по `GIT.md`, только свои
   файлы (`git add <пути>`).
10. Хуков Claude у тебя нет, поэтому перед каждым коммитом и после долгого шага запускай
    `bash .claude/hooks/check-upstream.sh` и `bash .claude/hooks/check-secrets.sh`:
    первый показывает чужие коммиты в `origin/main`, которые трогают твои файлы или
    общие правила. Противоречат твоей задаче — остановиться и сказать человеку.
11. Для каждой UI-фичи обязателен UI/UX skill gate из `CLAUDE.md`: до кода
    `ui-ux-pro-max` + `frontend-design`, затем `playwright-interactive`,
    `webapp-testing` + `playwright`, снимок «после», `accessibility-scan` +
    `accessibility-inspect` и `web-design-guidelines`; условные `diff`/`fix`/
    `audit`/`trace` запускаются по области риска. Записать команды и артефакты в
    описание MR.

Если правило здесь и в `CLAUDE.md` трактуется по-разному, действует более строгое.
