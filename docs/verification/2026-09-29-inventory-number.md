Closes #11

## Что сделано

- `nextInventoryNumber(plan, taken?)` и `withInventoryNumber(plan, object)` — `src/domain/commands/inventory-number.ts` (D-310). Серия читается из плана: префикс + хвост цифр, серия — префикс большинства, следующий = наибольший + 1 с его шириной; пропуски не заполняются (удалённый из середины номер не возвращается); «б/н» и другие номера без цифр в конце серию не задают; план без номеров начинает `ИНВ-0001` (допущение команды).
- Постановка из библиотеки (клик и перетаскивание — одна точка `use-equipment-tool-controller.ts`) ставит номер в той же `object.put`: одно «Отменить». На демо-плане новая скамья получает `ИНВ-ДЕМО-054` — ровно номер из `demo/after.json`.
- Копия (`Ctrl+C`/`Ctrl+V`, `Ctrl+D`) остаётся без номера — D-266 в силе (D-311).
- Находка `OBJECT_MISSING_INVENTORY_NUMBER` (предупреждение) рядом с `OBJECT_DUPLICATE_INVENTORY_NUMBER`: физический объект типа с атрибутом `inventoryNumber` без номера; текст «У объекта «…» нет инвентарного номера: впишите номер с ярлыка предмета в карточке.», ссылка и подсветка — объект. План, где номера нет ни у одного объекта (пример организаторов), молчит (D-312). Коды — модуля `src/domain/validation`, не контракта.
- Демо-планы новых находок не получают: `before` ошибки/предупреждения 1/2, `after` 0/0 — как раньше; `demo/*`, README, ZIP не менялись.

## Как проверено

| Команда | Результат |
|---|---|
| `npm test` | 110 файлов, 1575 passed, 1 skipped |
| `npm run typecheck && npm run lint && npm run build` | ок |
| `DEV_PORT=5322 npx playwright test tests/e2e/round-trip.spec.ts tests/e2e/validation.spec.ts` | 3/3 |
| `DEV_PORT=5322 npm run test:e2e` (после `git merge origin/main`, f033211) | 219 passed, 5 skipped, 2 failed — `shell.spec.ts:172` «шапка … одна строка» на 1280×800 и 1460×900; на чистом `origin/main` f033211 падает так же (проверено отдельным detached worktree, `DEV_PORT=5323`), к пакету не относится |
| мутации (9) | 0 выживших: `+1` в следующем номере, знак сравнения наибольшего, проверка `physical`, ширина `padStart`, выбор серии при равенстве, пропуск объекта с номером, «тихий» план без номеров, серьёзность, вызов в контроллере |
| `bash .claude/hooks/check-secrets.sh`, `check-upstream.sh manual` | пусто |

Сценарий в браузере «открыть → загрузить демо → изменить → сохранить → открыть заново»: пройден `tests/e2e/round-trip.spec.ts` «инвентарный номер новой скамьи выдан при постановке и переживает файл» (before.json → скамья из библиотеки → карточка `ИНВ-ДЕМО-054` → JSON → перезагрузка → открыть → тот же номер → повторный JSON с теми же номерами у всех 54 объектов); `demo.spec.ts` «рекомендация применяется руками … даёт ровно after.json» зелёный.

## UI/UX skill gate

Видимое изменение — одна новая строка находки в существующей панели «Проверка»; разметка и стили панели не менялись. Инструмента Skill у сборщика нет — fallback:

- не применены: `ui-ux-pro-max`, `frontend-design`, `playwright-interactive`, `webapp-testing`, `accessibility-scan`, `accessibility-inspect`, `web-design-guidelines`;
- бриф: задача — специалист видит предмет без номера; состояния — нет находки (демо), есть (копия), снята (номер вписан); иерархия и цвет — существующая строка `is-warning`; текст называет объект, не `id`;
- e2e: `tests/e2e/validation.spec.ts`, viewport 1440×900, маршрут `/` → открыть `demo/before.json` → Ctrl+C/Ctrl+V → «Проверка»;
- клавиатура и роли: ссылка находки — `button` с именем объекта, фокус + Enter выбирает копию (`data-entity-id="eq_54"`);
- снимок «после» (clip строки находки): `docs/verification/2026-09-29-inventory-number/missing-number-finding.png`.

## Контракт

- [x] не затронут

## Документы

- [x] `docs/decisions.md` — D-310, D-311, D-312
- [x] `docs/tz-compliance.md` — строка П8 «новый объект получает следующий номер; находка без номера»
- README модулей: `src/domain/commands`, `src/domain/validation`, `src/features/equipment`

## Ограничения и что вне пакета

- Вариант ассистента («Вставить в план»: `src/app/App.tsx:650` → `candidateObjectForInsert`, `src/domain/advice/candidate-object.ts`) и «Своя фигура» (`src/features/plan-tools/use-plan-tool-controller.ts:162`) номер не выдают — пути вне границ пакета. Подключение — обернуть созданный объект в `withInventoryNumber(current.document, object)` из `src/domain/commands`; пока находка D-312 показывает такие объекты.
- Номер удалённого в сессии последнего объекта при следующей постановке вернётся (объекта на плане уже нет, дубля нет): набора удалённых номеров, как `retired` у id, нет — сессия отдаёт инструментам только id (`EditorSession.retired`, контракт `src/contracts/ui.ts`).
