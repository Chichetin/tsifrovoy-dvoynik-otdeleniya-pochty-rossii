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

set -euo pipefail

PORT="${PORT:-8080}"
# Сколько ждать, пока контейнер соберётся и ответит. Первая сборка ставит
# зависимости npm и собирает SPA — это минуты, а не секунды.
WAIT_SECONDS="${WAIT_SECONDS:-600}"

say() { printf '\n== %s\n' "$1"; }
die() { printf '\nОШИБКА: %s\n' "$1" >&2; exit 1; }

[ -f compose.yaml ] || die "запускать из каталога проекта: рядом должен лежать compose.yaml"

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
echo "Первая сборка занимает несколько минут."
sudo -E PORT="${PORT}" docker compose up --build -d

say "4/4 Проверка"
deadline=$(( SECONDS + WAIT_SECONDS ))
health=""
until [ "${SECONDS}" -ge "${deadline}" ]; do
  if health="$(curl -fsS "http://127.0.0.1:${PORT}/api/health" 2>/dev/null)"; then
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

echo "Ответ /api/health: ${health}"
case "${health}" in
  *'"configured":true'*) echo "Модель настроена." ;;
  *) echo "Модель не настроена — ассистент работает без неё." ;;
esac

echo
echo "Адрес для проверяющего: http://<публичный IP машины>:${PORT}"
echo "Публичный IP виден в консоли Yandex Cloud на странице ВМ."
