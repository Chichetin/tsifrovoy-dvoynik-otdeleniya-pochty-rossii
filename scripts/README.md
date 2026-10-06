# scripts

Генерация нагрузочных планов, упаковка демо и сборка PDF-презентации.

**Владелец:** поток 5. **Пакеты:** Q02 E01 P01.

## Граница модуля

Не хранить здесь доменную логику и серверные обработчики. package.json/lock/scripts меняются одним владельцем потока 5.

## Файлы по плану

Следующие файлы создаются при реализации соответствующих пакетов:

- `gitlab-mr.sh` — создание и слияние Merge Request через API GitLab (`list`, `show`, `merge`, `create`).
- `issues.sh` — задачи команды в GitLab Issues (D-298): `list`, `free`, `mine`, `view`, `take`, `create`, `comment`, `labels`, `board` (сводка для хука начала сессии; строка «можно перехватить» — чужие задачи без движения > 2 ч, D-313). Нужны `curl` и `jq`; токен — `GITLAB_TOKEN` или git credential helper, не печатается.
- `generate-benchmark.ts` — Q02.
- `measure-advice.ts` — время расчёта ассистента (`measurePlan`, `validatePlan`, три сценария) на нагрузочных планах, медиана трёх прогонов (D-205).
- `package-demo.ts` — E01.
- `check-deployment.ts` — проверка HTTP, `status=ok` и SHA сервиса без браузера:
  `DEPLOY_URL=http://158.160.157.55:8080 npx tsx scripts/check-deployment.ts [SHA]`.
  Без аргумента ожидается `origin/main`; ожидание ответа — 5 с. Ошибка даёт код 1.
- `deploy-vm.sh` — выкладка на Ubuntu. В клоне берёт SHA из Git; для архива нужен
  `BUILD_SHA=<SHA исходного коммита>`. Чужой SHA, неверный health или отсутствие
  версии дают код 1. JSON проверяет Node внутри контейнера; jq на VM не нужен.
- `measure-3d.ts` — время от нажатия «3D» до сцены с моделями и кадры в секунду при
  вращении камеры (#59): `npx tsx scripts/measure-3d.ts <план|100|500|1000> [прогонов]`
  на запущенном приложении (`APP_URL`, по умолчанию `http://127.0.0.1:5174/`).
  `PW_CHANNEL=msedge` или `chrome` выбирает установленный браузер, как в e2e.
- `measure-drag.ts` — жесты на холсте (#169, #170, #190): перенос одного объекта,
  группы из десяти, перенос с подписями, панорама правой кнопкой, колесо, смена
  выделения. Планы: `demo`, `example` (`example_plan.json`), `1000` (синтетический).
  `npx tsx scripts/measure-drag.ts [прогонов] [планы] [жесты]`, например
  `npx tsx scripts/measure-drag.ts 5 demo,1000 one,pan`; медиана прогонов. Выводит
  время 30 шагов, худший и медианный кадр, работу главного потока на шаг и худший
  кадр за 0,4 с после отпускания. План из 1000 объектов скрипт сначала приближает
  до 18 px/м, чтобы объекты были нарисованы, а не карточки зон.
  Без `APP_URL` сам делает `vite build` и `vite preview` на `PREVIEW_PORT` (5189).
  `PW_CHANNEL` выбирает браузер, как в e2e.
- `measure-wheel.ts` — колесо мыши, свайп и щипок трекпада на демо-плане и на плане
  из 1000 объектов (#223): время жеста, худший кадр и шаг за событие.
  `npx tsx scripts/measure-wheel.ts [прогонов]`, медиана. `APP_URL`, `PREVIEW_PORT`
  и `PW_CHANNEL` — как у `measure-drag.ts`.
- `models/build.py` — 3D-модели типов в `public/models/<имя>.glb` (#59, D-357).
  Запуск: `~/.local/opt/blender-5.2.2-linux-x64/blender -b -P scripts/models/build.py --
  [имя …] [--preview <папка>]`. Размеры берёт из `data/catalog/object-types.json`,
  модели Poly Haven (CC0) скачивает во временную папку. `--preview` рисует миниатюры
  для проверки глазами.
- `capture-presentation.ts` — четыре снимка синтетического плана из работающего
  редактора в `build/presentation/`. Браузер — бандловый Chromium из
  `npx playwright install chromium`, системный ставить не нужно; другой канал —
  `PW_CHANNEL=chrome` (D-142, D-125). Адрес задаётся `PRESENTATION_BASE_URL`,
  по умолчанию `http://127.0.0.1:5196`.
- `make-presentation.py` — один PDF в `output/pdf/` из этих снимков и проверенных
  чисел. Нужны Python с `reportlab` и Pillow, шрифт Arial или DejaVu Sans с
  кириллицей. Путь к иному шрифту можно передать через `PRESENTATION_FONT_REGULAR`
  и `PRESENTATION_FONT_BOLD`.
- `presentation-pdf.ts` — PDF защиты из HTML-слайдов `presentation/`: каждый слайд
  открывается в `?static`, снимок 1920×1080 — одна страница. Рядом пишет `.sha256`,
  при размере больше 20 МБ падает. Слайд из `--steps` печатается без `?static`, по странице
  на шаг: в `?static` его шаги накладываются. Команда:
  `npx tsx scripts/presentation-pdf.ts [--variant plan] [--backup] [--steps s6] [--dir presentation] [--out output/pdf/ops-digital-twin-defense.pdf]`.

Для повтора P01: запустить собранный сервис с `STATIC_DIR` равным абсолютному
пути к `dist`, выполнить `npx tsx scripts/capture-presentation.ts`, затем
`python scripts/make-presentation.py`. Перед повторной сборкой проверить
подписи commit и замеров в скрипте: они относятся к кандидату 18.09.2026,
а не обновляются автоматически. PDF нужно снова отрендерить и осмотреть.

[Карта проекта и владельцы](../docs/project-structure.md) · [Контракты](../docs/contracts-v1.md)
