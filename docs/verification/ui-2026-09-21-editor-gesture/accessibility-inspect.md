# Ручная accessibility-проверка жестов редактора

Дата: 2026-09-21

Маршрут: `http://127.0.0.1:5199/`

Viewport: `1440×900`; после загрузки — демо `demo/before.json`.

## Функциональный проход

- Панель инструментов и кнопка «Рука» видны в live DOM; у кнопки есть имя,
  `aria-pressed` и подсказка с тачпадом/средней кнопкой/колесом.
- Плавная pixel-wheel дельта `18,16` изменила `data-visible`, не изменив
  подпись масштаба.
- Дискретное колесо `0,-120` и `Ctrl`+колесо `0,-60` увеличили `px/м`.
- Удержание средней кнопки с перемещением указателя изменило `data-visible`,
  масштаб остался прежним.
- Клавиатурная альтернатива сохранена: инструмент «Рука» выбирается кнопкой,
  вписывание плана — кнопкой «Вписать» и клавишей `F`.

## Automated tier

Команда:

```text
ACCESSLINT_PORT=$(npx -y @accesslint/chrome@latest ensure | node -e 'process.stdin.on("data",d=>process.stdout.write(""+JSON.parse(d).port))')
npx -y @accesslint/cli@latest scan http://127.0.0.1:5199/ --port "$ACCESSLINT_PORT" --format json
```

Результат: `violations: []`, `ruleCount: 94`, Chrome `HeadlessChrome/153`,
`780×493`. Полный JSON: `accessibility-scan.json`.

## Manual tier

В этой сессии нет `js_repl` и `chrome-devtools` MCP, поэтому вместо штатного
interactive-инструмента использован fallback `playwright-cli`: snapshot live
DOM, реальные `Tab`, `Control++`, `Control+0`, мышь и колесо. Восьми первых
остановках Tab виден `2px` focus ring `rgb(11, 92, 173)`; роли/имена кнопок,
полей и групп присутствуют в snapshot.

Ledger:

- `● verified`: 2.1.1, 2.5.1, 2.5.7, 2.5.8, 4.1.2 — клавиатурный обход и
  pointer-пути проверены; жесты имеют кнопку/клавиатурную альтернативу.
- `● verified`: 1.3.1, 1.3.2, 2.4.1, 2.4.6 — проверены по snapshot,
  семантические `button`, `toolbar`, `group`, `main` и headings присутствуют.
- `◐ flagged`: 1.4.4, 1.4.10, 1.4.12 — два `Control++`/`Control+0` выполнились,
  но browser zoom не выдаёт надёжный CSS-scale через этот CLI; требуется
  отдельная проверка человеком с реальным браузерным zoom и screen reader.
- `○ human-required`: 4.1.3 — фактическое объявление изменений screen reader
  не проверялось; нужны NVDA/JAWS/VoiceOver.
- `N/A`: формы ошибок, media/timing и cross-page consistency не относятся к
  этой локальной интеракции.

## Финальный UI review

`web-design-guidelines` применён к `EditorCanvas.tsx`, `viewport.ts`,
`PlanTools.tsx` и связанным стилям: новых нарушений не найдено. Кнопка
семантическая, focus-visible общий, hover/active состояния есть; swipe/pinch
не являются единственным способом действия. Снимки состояния «после»:

- `01-after-trackpad-pan-canvas.png` — clipped canvas после плавной дельты;
- `03-after-demo-1440x900.png` — viewport 1440×900;
- `04-after-demo-canvas-1440x900.png` — clipped canvas на целевом viewport.

Ограничение gate: interactive MCP и реальный screen-reader runtime недоступны;
fallback и human-required пункты оставлены явно, без заявления о полной WCAG
конформности.
