# scripts

Генерация нагрузочных планов, упаковка демо и сборка PDF-презентации.

**Владелец:** поток 5. **Пакеты:** Q02 E01 P01.

## Граница модуля

Не хранить здесь доменную логику и серверные обработчики. package.json/lock/scripts меняются одним владельцем потока 5.

## Файлы по плану

Следующие файлы создаются при реализации соответствующих пакетов:

- `gitlab-mr.sh` — создание и слияние Merge Request через API GitLab (`list`, `show`, `merge`, `create`).
- `generate-benchmark.ts` — Q02.
- `package-demo.ts` — E01.
- `capture-presentation.ts` — четыре снимка синтетического плана из работающего
  редактора в `build/presentation/`. Браузер — бандловый Chromium из
  `npx playwright install chromium`, системный ставить не нужно; другой канал —
  `PW_CHANNEL=chrome` (D-142, D-125). Адрес задаётся `PRESENTATION_BASE_URL`,
  по умолчанию `http://127.0.0.1:5196`.
- `make-presentation.py` — один PDF в `output/pdf/` из этих снимков и проверенных
  чисел. Нужны Python с `reportlab` и Pillow, шрифт Arial или DejaVu Sans с
  кириллицей. Путь к иному шрифту можно передать через `PRESENTATION_FONT_REGULAR`
  и `PRESENTATION_FONT_BOLD`.

Для повтора P01: запустить собранный сервис с `STATIC_DIR` равным абсолютному
пути к `dist`, выполнить `npx tsx scripts/capture-presentation.ts`, затем
`python scripts/make-presentation.py`. Перед повторной сборкой проверить
подписи commit и замеров в скрипте: они относятся к кандидату 18.09.2026,
а не обновляются автоматически. PDF нужно снова отрендерить и осмотреть.

[Карта проекта и владельцы](../docs/project-structure.md) · [Контракты](../docs/contracts-v1.md) · [План задач](../docs/plans/2026-09-16-parallel-plan.md)
