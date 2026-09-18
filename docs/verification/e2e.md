# Q01 — сквозная проверка

База `main` на старте: `818f8b3` (18.09.2026). Браузер: установленный Chrome
153.0.8010.12 на Windows. Тесты идут против Vite из этого worktree на
отдельном порту 5186 (`DEV_PORT=5186`, `PW_REUSE_SERVER=1` только при явно
запущенном здесь сервере). Без такого сервера Playwright стартует собственный.

## Первый проверенный сценарий

`npm run test:e2e -- tests/e2e/round-trip.spec.ts` — 1/1. Открыт исходный
`example_plan.json` организаторов: 4 зоны и 12 объектов. В карточке терминала
изменены положение, поворот и имя, файл скачан, страница перезагружена, файл
открыт снова. Повторное сохранение совпало с первым JSON целиком: идентификаторы,
геометрия, слои, связи, каталог и атрибуты остались теми же.

Каталог внутри файла организаторов для терминала не задаёт редактируемых
атрибутов. Второй сценарий загружает наш файл с новым типом «Стойка Q01»,
добавленным только в каталог данных. Сначала он обнаружил дефект: библиотека
показывала стартовый каталог вместо каталога открытого документа. `App.tsx`
теперь передаёт `document.catalog` (D-097). После исправления тип появился в
библиотеке; объект поставлен на холст, числовой и логический атрибуты изменены,
объект перенесён на новый слой. После перезагрузки страницы оба атрибута,
слой и новая запись каталога сохранились; повторная запись дала тот же JSON.
`npm run test:e2e -- tests/e2e/catalog-extension.spec.ts` — 1/1.

## Общая регрессия и собранный сервис

`DEV_PORT=5186 PW_REUSE_SERVER=1 CI=1 npm run test:e2e -- -c
playwright.qa.config.ts --workers=2 --reporter=dot` — **43 passed, 5 skipped**:
тесты деплоя преднамеренно требуют адрес в `DEPLOY_URL`. В наборе проверяются
невалидные файлы, черновик, жесты, свойства, слои, 3D и fallback ассистента.

При запуске собранного сервиса `npm run serve` на Windows обнаружена ошибка:
сравнение `import.meta.url` с `file://` + системный путь молча обходило точку
входа. `server/main.ts` теперь переводит URL в системный путь (D-098). Сервер
слушал `127.0.0.1:5188`, `STATIC_DIR` указывал на локальную `dist`, ключ LLM
не задан. `DEPLOY_URL=http://127.0.0.1:5188` с тем же QA-конфигом:
`tests/e2e/deployment.spec.ts` — **5/5**; полный набор — **48/48 (34.1s)**.
Это проверяет health, готовую SPA, fallback без ключа, загрузку и сохранение.

Проверка выполнена на локальном сервисе, а не на публичном URL или в Docker.
Тест реального провайдера LLM и ручной прогон README остаются отдельными
пунктами перед сдачей. Для повторения Windows-прогона Vite на 5186 нужно
запустить именно из этого worktree; `PW_REUSE_SERVER=1` разрешает использование
уже работающего сервера и потому не подходит для чужого порта.

## Прогон по README на машине без Google Chrome (18.09.2026)

Проверялось то, что делает проверяющий: клонировать репозиторий и выполнить
команды из README. Машина — Arch Linux, системного Chrome нет
(`which google-chrome` пусто, каталога `/opt/google/chrome` нет).

До правки четыре сценария (`round-trip.spec.ts`, оба теста `demo.spec.ts`,
`catalog-extension.spec.ts`) падали на запуске браузера:

```bash
$ DEV_PORT=5193 npx playwright test tests/e2e/round-trip.spec.ts \
    tests/e2e/catalog-extension.spec.ts tests/e2e/demo.spec.ts --workers=2
Error: browserType.launch: Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome
4 failed
```

После перевода набора на бандловый Chromium (D-125) те же четыре — зелёные:

```bash
$ DEV_PORT=5193 npx playwright test tests/e2e/round-trip.spec.ts \
    tests/e2e/catalog-extension.spec.ts tests/e2e/demo.spec.ts --workers=2
4 passed (9.3s)

$ DEV_PORT=5193 npm run test:e2e -- --workers=2
55 passed, 5 skipped (1.6m)
```

Пять пропущенных — `tests/e2e/deployment.spec.ts` без `DEPLOY_URL`, это ожидаемо.

### Чистый клон, команды README дословно

Ветка `worktree-infra-e2e-chrome`, commit `36976b4`, каталог вне рабочей копии,
свой `node_modules`:

```bash
$ git clone --branch worktree-infra-e2e-chrome <репозиторий> clean && cd clean
$ npm ci
$ npx playwright install chromium
$ DEV_PORT=5193 npm run test:e2e
55 passed, 5 skipped (1.9m)
$ npm test
Test Files  35 passed | 1 skipped (36)
     Tests  495 passed | 1 skipped (496)
$ npm run typecheck && npm run lint && npm run build
без ошибок, сборка «built in 1.00s»
```

Проверка на системном браузере не потеряна: `PW_CHANNEL=chrome npm run test:e2e`
запускает тот же набор в установленном Chrome, а `playwright.qa.config.ts`
остаётся входом для QA-машины с Chrome.
