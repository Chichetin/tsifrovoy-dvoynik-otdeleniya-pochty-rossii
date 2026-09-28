#!/usr/bin/env bash
# Создание и слияние Merge Request в GitLab хакатона. Merge — только MR задачи:
# ветка worktree-<N>-<тема> и открытая задача #N (D-299).
#
# Токен берётся из git credential helper: в репозиторий он не попадает и в
# вывод не печатается. Merge — обычным merge-коммитом без squash, иначе
# правило уборки в GIT.md перестаёт видеть ветку как влитую.
#
#   bash scripts/gitlab-mr.sh list
#   bash scripts/gitlab-mr.sh show <iid>
#   bash scripts/gitlab-mr.sh merge <iid>
#   bash scripts/gitlab-mr.sh create <ветка> <заголовок>

set -euo pipefail

HOST='git.codenrock.com'
PROJECT='codenrock%2Fkhakaton-postcode-challenge-ot-pochtatekha%2Fii-blanki%2Ftsifrovoy-dvoynik-otdeleniya-pochty-rossii'

BODY=$(mktemp)
trap 'rm -f "$BODY"' EXIT

die() { printf '%s\n' "$*" >&2; exit 1; }

read_token() {
  local token
  token=$(printf 'protocol=https\nhost=%s\n\n' "$HOST" | git credential fill | sed -n 's/^password=//p')
  [ -n "$token" ] || die "Токен для $HOST не найден в credential helper."
  printf '%s' "$token"
}

# Пишет тело ответа в $BODY, печатает код HTTP.
api() {
  curl -sS -X "$1" -H "PRIVATE-TOKEN: $(read_token)" \
    -o "$BODY" -w '%{http_code}' "https://${HOST}/api/v4/$2"
}

# Первое значение поля из тела ответа: строка, число, true/false или null.
field() {
  grep -o "\"$1\":\(\"[^\"]*\"\|-\?[0-9]\+\|true\|false\|null\)" "$BODY" \
    | head -1 | sed 's/^"[^"]*"://; s/^"//; s/"$//'
}

require() {
  local got="$1" want="$2" what="$3"
  [ "$got" = "$want" ] || die "$what: GitLab ответил $got — $(field message)"
}

cmd_list() {
  require "$(api GET "projects/${PROJECT}/merge_requests?state=opened&per_page=50")" 200 'Список MR'
  grep -o '"iid":[0-9]*\|"title":"[^"]*"\|"source_branch":"[^"]*"' "$BODY" \
    | sed 's/"iid":/\nMR !/; s/"title":/  /; s/"source_branch":/  ветка /' | tr -d '"'
}

cmd_show() {
  [ -n "$1" ] || die 'Укажите номер MR.'
  require "$(api GET "projects/${PROJECT}/merge_requests/$1")" 200 "MR !$1"
  printf 'MR !%s\n  заголовок: %s\n  ветка:     %s → %s\n  состояние: %s\n  конфликты: %s\n' \
    "$(field iid)" "$(field title)" "$(field source_branch)" \
    "$(field target_branch)" "$(field state)" "$(field has_conflicts)"
}

cmd_merge() {
  local iid="$1" state conflicts
  [ -n "$iid" ] || die 'Укажите номер MR.'

  require "$(api GET "projects/${PROJECT}/merge_requests/${iid}")" 200 "MR !${iid}"
  state=$(field state)
  conflicts=$(field has_conflicts)
  [ "$state" = opened ] || die "MR !${iid} в состоянии «${state}», сливать нечего."
  [ "$conflicts" != true ] || die "MR !${iid}: конфликты, нужен ручной merge."

  # Без задачи не вливаем (D-299): ветка worktree-<N>-<тема>, задача #N открыта.
  local branch issue
  branch=$(field source_branch)
  issue=$(printf '%s' "$branch" | sed -n 's/^worktree-\([0-9][0-9]*\)-.*/\1/p')
  [ -n "$issue" ] || die "MR !${iid}: ветка «${branch}» без номера задачи — сначала задача и ветка worktree-<N>-<тема> (GIT.md)."
  require "$(api GET "projects/${PROJECT}/issues/${issue}")" 200 "Задача #${issue} для MR !${iid}"
  [ "$(field state)" = opened ] || die "MR !${iid}: задача #${issue} не открыта ($(field state))."
  require "$(api GET "projects/${PROJECT}/merge_requests/${iid}")" 200 "MR !${iid}"

  require "$(api PUT "projects/${PROJECT}/merge_requests/${iid}/merge?squash=false&should_remove_source_branch=true")" 200 "MR !${iid} не влит"
  printf 'MR !%s влит: %s\n  merge-коммит: %s\n' "$iid" "$(field title)" "$(field merge_commit_sha)"
}

cmd_create() {
  local branch="$1" title="$2"
  { [ -n "$branch" ] && [ -n "$title" ]; } || die 'Нужны ветка и заголовок.'
  require "$(api POST "projects/${PROJECT}/merge_requests?source_branch=${branch}&target_branch=main&title=$(printf '%s' "$title" | sed 's/ /%20/g')")" 201 'Создание MR'
  printf 'MR !%s создан: %s\n' "$(field iid)" "$(field web_url)"
}

case "${1:-}" in
  list)   cmd_list ;;
  show)   cmd_show "${2:-}" ;;
  merge)  cmd_merge "${2:-}" ;;
  create) cmd_create "${2:-}" "${3:-}" ;;
  *)      die 'Команды: list | show <iid> | merge <iid> | create <ветка> <заголовок>' ;;
esac
