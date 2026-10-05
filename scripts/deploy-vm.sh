#!/usr/bin/env bash
#
# Развёртывание «Цифрового двойника ОПС» на чистой виртуальной машине с
# Ubuntu 24.04. Запускается НА машине, из каталога проекта:
#
#   bash scripts/deploy-vm.sh
#
# Что делает: ставит Docker, если его нет, поднимает сервис одним контейнером и
# ждёт, пока он станет здоровым. Ключ LLM скрипт не спрашивает и никуда не
# записывает: он берётся из файла .env рядом с compose.yaml, который создаётся
# руками (см. docs/hosting-yandex-cloud.md). Без .env сервис тоже работает —
# ассистент считает сам и помечает ответ «без LLM».
#
# Порт: PORT=8081 bash scripts/deploy-vm.sh
# Архив без .git: BUILD_SHA=<SHA исходного коммита> bash scripts/deploy-vm.sh

set -euo pipefail

PORT="${PORT:-8080}"
# Сколько ждать, пока контейнер соберётся и ответит. Первая сборка ставит
# зависимости npm и собирает SPA — это минуты, а не секунды.
WAIT_SECONDS="${WAIT_SECONDS:-600}"

say() { printf '\n== %s\n' "$1"; }
die() { printf '\nОШИБКА: %s\n' "$1" >&2; exit 1; }

[ -f compose.yaml ] || die "запускать из каталога проекта: рядом должен лежать compose.yaml"

# git archive не содержит .git: оператор передаёт SHA исходного коммита.
# В клоне нельзя пометить текущие исходники версией другого коммита.
checkout_sha="$(git rev-parse --short HEAD 2>/dev/null || true)"
BUILD_SHA="${BUILD_SHA:-${checkout_sha}}"
[[ "${BUILD_SHA}" =~ ^[0-9a-fA-F]{7,40}$ ]] \
  || die "неизвестен SHA исходников: для архива задайте BUILD_SHA=<SHA коммита>"
BUILD_SHA="${BUILD_SHA,,}"
if [ -n "${checkout_sha}" ] && [[ "${BUILD_SHA}" != "${checkout_sha}"* && "${checkout_sha}" != "${BUILD_SHA}"* ]]; then
  die "BUILD_SHA=${BUILD_SHA} не совпадает с текущими исходниками ${checkout_sha}"
fi

say "1/4 Docker"
if docker compose version >/dev/null 2>&1; then
  echo "Docker с плагином compose уже есть: $(docker compose version)"
else
  echo "Ставлю docker.io и docker-compose-v2 из репозиториев Ubuntu."
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker.io docker-compose-v2
  sudo systemctl enable --now docker
  # Без этого docker требует sudo на каждый вызов. Права применятся при
  # следующем входе по SSH; в этом сеансе ниже всё равно используется sudo.
  sudo usermod -aG docker "$USER" || true
  docker_version="$(sudo docker compose version)"
  echo "Поставлено: ${docker_version}"
fi

say "2/4 Ключ модели"
if [ -f .env ]; then
  echo "Файл .env найден — переменные уйдут в контейнер окружением."
else
  echo "Файла .env нет. Сервис поднимется без модели: ассистент будет считать"
  echo "сам и честно помечать ответ «без LLM». Это штатный режим."
  echo "Нужна модель — создайте .env (docs/hosting-yandex-cloud.md, шаг 6) и"
  echo "повторите запуск."
fi

say "3/4 Сборка и запуск"
# #136: SHA исходников — его покажут /api/health и «Настройки».
echo "Собираю коммит ${BUILD_SHA}. Первая сборка занимает несколько минут."
sudo -E PORT="${PORT}" BUILD_SHA="${BUILD_SHA}" docker compose up --build -d

say "4/4 Проверка"
deadline=$(( SECONDS + WAIT_SECONDS ))
health=""
until [ "${SECONDS}" -ge "${deadline}" ]; do
  if health="$(curl -fsS --max-time 5 "http://127.0.0.1:${PORT}/api/health" 2>/dev/null)"; then
    break
  fi
  sleep 5
done

if [ -z "${health}" ]; then
  echo "Сервис не ответил за ${WAIT_SECONDS} с. Смотрите, что произошло:"
  echo "  sudo docker compose ps"
  echo "  sudo docker compose logs --tail=50"
  exit 1
fi

# Node уже есть в запущенном контейнере; отдельный JSON-парсер на VM не нужен.
if ! sudo -E PORT="${PORT}" BUILD_SHA="${BUILD_SHA}" docker compose exec -T app node -e '
  const [expected, raw] = process.argv.slice(1);
  try {
    const health = JSON.parse(raw);
    if (health?.status !== "ok") throw new Error("Сервис не подтвердил status=ok.");
    if (typeof health.build !== "string" || !/^[0-9a-f]{7,40}$/i.test(health.build)) {
      throw new Error("Сервис не сообщает SHA сборки.");
    }
    const actual = health.build.toLowerCase();
    if (!actual.startsWith(expected) && !expected.startsWith(actual)) {
      throw new Error(`Сервис работает на ${actual}, ожидалась сборка ${expected}.`);
    }
    console.log(`Сборка ${actual} подтверждена.`);
  } catch (error) {
    console.error(error instanceof SyntaxError ? "Некорректный JSON от /api/health." : error.message);
    process.exitCode = 1;
  }
' "${BUILD_SHA}" "${health}"; then
  die "выкладка не подтверждена: проверьте контейнер, порт и /api/health"
fi
case "${health}" in
  *'"configured":true'*) echo "Модель настроена." ;;
  *) echo "Модель не настроена — ассистент работает без неё." ;;
esac

echo
echo "Адрес для проверяющего: http://<публичный IP машины>:${PORT}"
echo "Публичный IP виден в консоли Yandex Cloud на странице ВМ."
