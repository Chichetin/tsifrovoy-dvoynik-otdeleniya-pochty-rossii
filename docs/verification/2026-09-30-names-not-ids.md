# Имена вместо голых id в текстах для сотрудника — Issue #10

## Что собрано и проверено

По задаче: собрать все тексты, которые видит сотрудник (ассистент без LLM: три
сценария + свободный чат, находки проверки, карточка свойств, отчёт сравнения) на
`demo/before.json` и `demo/after.json`, найти голые `z_…`/`eq_…`/`ot_…`/`zt_…`/`l_…`.

- `ValidationPanel` (V02, D-235), `PropertiesPanel` (данные только в `data-entity-id`) и
  `ComparisonPanel` (#5, D-2xx недавнего MR) уже называли зоны и объекты именем, id — в
  `title`/`data-ref-id`/`<details><summary>ID</summary>`. Изменений не потребовалось.
- Найдены и исправлены три места, где сотрудник видел голый id:
  1. Чат ассистента (`AgentChat.tsx`) — текст ответа (и без LLM, и с LLM) содержит id либо
     сам по себе, либо в форме «name» (id); раньше при клике показывался сам id
     (`«показать на плане»` → подпись кнопки была `z_storage`).
  2. Структурная карточка рекомендации (`AssistantPanel.tsx`) — зона варианта
     (`candidateZone`) писала `зона «Хранение и посылки» (z_storage)`, «Ссылки» и
     «Изменения» показывали голый `ref.id` без имени вовсе.
  3. Ограничения рекомендации (`recommendation.limitations`) — единственное поле карточки
     вне «Допущения и правила» (`<details>`), которое могло донести id из
     `zoneFitNotes` (`src/domain/advice/index.ts`).
- Решения — D-320 (единая точка показа в `AgentChat.tsx`), D-321 (`hideNamedIds` для
  текста без ссылки на клик) и D-322 (карточка рекомендации).

## Мутации

5 сделано (все на функциях подстановки/показа названий), 0 выжило на первом прогоне:

1. `AgentChat.tsx`: подпись кнопки — сырой `token` вместо `names.nameOf(ref)` →
   упало 9 тестов (`AgentChat.test.tsx` + `no-bare-ids.test.tsx`).
2. `AgentChat.tsx`: `refFor` всегда возвращает `null` → упало 2 теста
   (`AgentChat.test.tsx`).
3. `hideNamedIds` (`agent-fallback.ts`): возвращает текст без изменений → упало
   4 теста (`agent-fallback.test.ts` + `AssistantPanel.test.tsx`).
4. `AssistantPanel.tsx`: `candidateZone` возвращает id в скобках → упал 1 тест
   (`AssistantPanel.test.tsx`).
5. `AssistantPanel.tsx`: кнопки «Изменения»/«Ссылки» показывают `change.ref.id` →
   упал 1 тест (`AssistantPanel.test.tsx`).

## Команды и результаты

```
npm run typecheck                                  # ок
npm run lint                                        # ок
npm test                                             # 1667 passed, 1 skipped
npm run build                                        # ок (предупреждение о крупных чанках — не по задаче)
DEV_PORT=5398 CI=1 npx playwright test tests/e2e/assistant.spec.ts \
  tests/e2e/assistant-facts.spec.ts tests/e2e/assistant-insert.spec.ts \
  tests/e2e/validation.spec.ts tests/e2e/comparison-file.spec.ts \
  tests/e2e/demo.spec.ts --workers=2                 # 21 passed
DEV_PORT=5398 CI=1 npx playwright test --workers=2   # 232 passed, 5 skipped, 0 failed
bash .claude/hooks/check-secrets.sh                  # пусто
```

## Сторож-тест

`src/features/assistant/no-bare-ids.test.tsx` — 19 тестов на обоих демо-планах:
7 вопросов чата без LLM (`answerWithoutModel` → рендер `AgentChat`, проверка
`.agent__text` регулярным выражением `\b(?:z|eq|ot|zt|l)_[a-z0-9_]*\b`) плюс сценарии
«место», «комплектование» и «эффект изменений» (рендер `AssistantPanel`, проверка
`.advice__sentence`/`.advice__zone`/`.advice__changes`/`.advice__refs`/`.advice__limitations`,
кроме `.advice__more` — тот текст умышленно остаётся с id за раскрытием «Допущения и
правила», это и есть требуемая деталь).

## UI/UX skill gate — fallback

Скиллы `ui-ux-pro-max`, `frontend-design`, `playwright-interactive`, `webapp-testing`,
`playwright`, `accessibility-scan`, `accessibility-inspect`, `web-design-guidelines` в этой
сессии недоступны (нет отдельного инструмента вызова скиллов). Fallback:

- бриф — этот файл и решения D-320…D-322;
- детерминированный e2e — `assistant.spec.ts`/`assistant-facts.spec.ts` (клик по кнопке с
  именем ведёт на план: `z_client` → «Клиентский зал», `eq_25` → «Камера зала (вход)»);
- клавиатура — новые/изменённые элементы это обычные `<button type="button">`
  (нативно фокусируемые, активируются Enter/Space), автофокус и порядок обхода не
  менялись; кастомных виджетов не добавлено;
- снимки не делались: `UPDATE_SNAPSHOTS` не был задан, изменение точечное (подпись
  существующих кнопок и абзацев текста), не затрагивает раскладку.

Перед merge — ревью человека или свежего субагента (риск: формат сохранения и модель
данных не менялись, но затронут ассистент — критерий 20%).
