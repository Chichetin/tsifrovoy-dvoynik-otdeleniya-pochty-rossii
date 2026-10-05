# I01: образ сервиса «Цифровой двойник ОПС».
#
# Один контейнер отдаёт и собранный SPA, и /api — адрес для проверяющего один.
# Сборка идёт в отдельной ступени: в итоговый образ не попадают ни исходники
# TypeScript, ни devDependencies, ни тесты (см. .dockerignore).
#
# Сервер написан на TypeScript и в разработке запускается через tsx, но tsx —
# devDependency. Вместо того чтобы тащить весь dev-набор в runtime, сервер
# собирается тем же Vite в один ESM-файл `build/server/main.js`, а пакеты из
# dependencies остаются внешними и ставятся `npm ci --omit=dev` (решение D-090).

FROM node:22-alpine AS build
WORKDIR /app

# Отдельный слой на зависимости: правка кода не переустанавливает npm-пакеты.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# #136: SHA сборки. В образе нет .git, поэтому его передаёт выкатка (deploy-vm.sh).
# Пусто — «Настройки» и /api/health честно говорят, что сборка неизвестна.
ARG BUILD_SHA=
# `npm run build` = tsc --noEmit + vite build: сломанные типы валят сборку образа.
RUN npm run build && npm run build:server

FROM node:22-alpine AS runtime
WORKDIR /app
# HOST=0.0.0.0: внутри контейнера слушать только петлю бессмысленно — наружу
# порт отдаёт Docker. PORT переопределяется окружением, STATIC_DIR указывает на
# собранный SPA абсолютным путём, чтобы не зависеть от рабочего каталога.
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 STATIC_DIR=/app/dist
ARG BUILD_SHA=
ENV BUILD_SHA=${BUILD_SHA}

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/build/server ./build/server

# Пользователь node есть в официальном образе; root для раздачи файлов не нужен.
USER node
EXPOSE 8080

# wget — из busybox, без лишних пакетов в образе. Порт берётся из окружения:
# health должен проверять тот порт, который слушает процесс.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --quiet --spider "http://127.0.0.1:${PORT:-8080}/api/health" || exit 1

CMD ["node", "build/server/main.js"]
