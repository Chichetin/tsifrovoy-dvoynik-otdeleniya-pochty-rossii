# Docker-путь проверяющего локально — 22.09.2026

Код `origin/main` **`7c61c08`**, Linux (Manjaro 6.12), Docker 29.7.2, без `.env` — ассистент в
режиме «Без LLM», как у проверяющего без ключа.

| Шаг | Команда | Результат |
|---|---|---|
| Сборка образа | `docker build --network=host -t ops-digital-twin:local .` | собрано за 71 с |
| Запуск | `docker run -d --network host -e HOST=127.0.0.1 -e PORT=8090 ops-digital-twin:local` | `GET /api/health` → 200 `{"status":"ok","llm":{"configured":false}}` |
| Сценарии развёрнутого сервиса | `DEPLOY_URL=http://127.0.0.1:8090 npx playwright test tests/e2e/deployment.spec.ts` | до правки 4 passed / 1 failed, после — **5 passed** (14,3 с) |

**Что упало и почему.** Сценарий «ассистент отвечает…» искал «Спросить» в панели ассистента
сразу после открытия, а с пакетов вкладок (D-249 и позже) панель скрыта за вкладкой
«Ассистент». В обычном `npm run test:e2e` файл пропускается без `DEPLOY_URL`, поэтому
устаревание не было видно. Тест теперь открывает вкладку, как `assistant.spec.ts`.

**Сеть на этой машине.** `docker compose up --build -d` здесь не проходит: внутри bridge-сети
Docker не работает DNS (`npm ci` → `EAI_AGAIN`, «Exit handler never called!») и не
пробрасываются порты (пустой ответ даже у минимального контейнера на `node:22-alpine`).
Это настройка машины, а не проекта, поэтому образ собран и запущен в сети хоста. На машине с
рабочей сетью Docker путь из README (`docker compose up --build -d`) не менялся; на публичном
сервере его нужно повторить тем же `deployment.spec.ts`.
