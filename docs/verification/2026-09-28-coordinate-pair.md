# Задача #1 — совместное применение X/Y, 28.09

База `6093480`, задача #1 закреплена за `maxsedov99`; ветка
`worktree-1-coordinate-pair`, отдельный worktree. Формат, геометрия и физика прежние.

## Дефект и исправление

На `demo/before.json` скамья `eq_54` в `[7.5, 1]` не переносилась полями в
`[2.2, 2]`: обе промежуточные точки дают OBJECT_COLLISION. Воспроизводящий тест
подтвердил оба отказа и отсутствие общего действия до исправления (3 failed).
Теперь поля держат общий черновик; кнопка/Enter отправляет одну object.put.
Отказ и некорректное число не теряют ввод и не изменяют документ; сброс/Esc,
новый выбор и внешнее перемещение показывают актуальную точку. Один undo/redo
возвращает обе координаты. Ввод во время переноса отключён, gesture preview работает.

Браузер выявил дополнительный конфликт: capture-обработчик Escape на холсте
снимал выбор раньше формы. Он теперь использует существующий `isTypingTarget`:
в поле Escape принадлежит вводу, на холсте остаётся прежняя отмена жеста/выбора.
Регрессия на сохранение выбора после Esc прошла на двух размерах окна.

Путь демо, focus и round-trip переведены на явное применение; старые обходы
«ввести Y раньше X» из комментариев убраны. Справочник, ID, размеры и атрибуты
не меняются при перемещении.

## Проверки

- `npm.cmd ci` — 312 пакетов, audit 0 vulnerabilities.
- `npm.cmd test -- src/app/coordinate-pair.test.tsx src/features/properties/PropertiesPanel.test.tsx` — 35 passed.
- `npm.cmd test` — 1479 passed / 1 skipped.
- `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run build` — exit 0.
  Сохраняется прежнее предупреждение сборки о chunks >500 kB.
- Playwright: DEV_PORT=5424, PW_REUSE_SERVER=1, установленный Chromium 1243 основной копии через PLAYWRIGHT_BROWSERS_PATH. Vite из своего worktree работает отдельным процессом.
- Первый targeted: 16 passed / 2 failed — оба обнаружили Escape; после исправления `coordinate-pair.spec.ts` — 2 passed, 6,3 с. Проверены отказ, Enter, один undo/redo, пустое поле, Esc, JSON с ID/атрибутами/zoneId и повторное открытие.
- `npx.cmd playwright test --workers=2` — 212 passed / 5 skipped, 3,6 минуты,
  без падений и retries; пропущены deployment-проверки без DEPLOY_URL.
- `check-upstream.sh`, `check-secrets.sh`, `git diff --check` — чисто.

## UI gate и артефакты

Бриф: сотрудник вводит точную конечную точку без промежуточной коллизии;
явное применение, сохранение ввода при отказе, видимый текст ошибки, клавиатура,
desktop 1280×800/1440×900. Использованы существующие цвета/стили и focus-ring.
Кнопки переносятся в узкой панели; e2e проверяет, что оба поля и применение
остаются внутри карточки после Home на границе панели (минимум 160 px).

Снимки `coordinates-after.png` в `test-results/coordinate-pair-…-1280/1440-…`:
просмотрена компактная карточка на 1280, X/Y и обе кнопки читаются, поля и кнопки
не выходят за панель. Длинное название в узкой панели обрезано — существующее
поведение, исправление подписей/компоновки не относится к этому багфиксу.
Копии: [1280](2026-09-28-coordinates-1280.png), [1440](2026-09-28-coordinates-1440.png).
Логи: `coordinate-red.log`, `e2e-coordinate.log`, `e2e-pair-fixed.log`,
`unit-final.log`, `e2e-all.log`; JSON и traces — локально в test-results.

Скиллы `ui-ux-pro-max`, `frontend-design`, `playwright-interactive`,
`webapp-testing`, `accessibility-scan/inspect`, `web-design-guidelines`,
`playwright-trace` отсутствуют в каталоге среды. Fallback: Playwright-сценарии,
просмотр снимка, именованные формы/поля/кнопки, aria-invalid/описания ошибок,
Enter/Escape и проверка границ панели. Полный skill gate и автоматический
a11y-scan не объявляются пройденными. Публичный деплой и live LLM здесь не проверялись.
