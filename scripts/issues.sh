#!/usr/bin/env bash
# GitLab Issues проекта — очередь задач команды (D-298). Замена `gh issue` без glab:
# curl + jq к API того GitLab, где лежит origin. Токен — GITLAB_TOKEN, иначе из git
# credential helper для хоста origin (тот же, которым делается push). Токен не печатается.
#
#   bash scripts/issues.sh list [метка]      открытые задачи, можно по метке (area:editor, P0, blocker)
#   bash scripts/issues.sh free [метка]      открытые и никем не взятые
#   bash scripts/issues.sh mine              мои открытые
#   bash scripts/issues.sh view <N>          задача целиком
#   bash scripts/issues.sh take <N>          взять: назначить себя; занятую другим или чужую area: не берёт
#   bash scripts/issues.sh create <заголовок> <метки через запятую> <файл описания>
#   bash scripts/issues.sh comment <N> <файл|->
#   bash scripts/issues.sh labels            создать недостающие метки команды
#   bash scripts/issues.sh board             сводка для хука начала сессии
set -euo pipefail

cmd="${1:-help}"
[ $# -gt 0 ] && shift

remote="$(git remote get-url origin)"
host="$(printf '%s' "$remote" | sed -E 's#^https?://([^/@]+@)?([^/]+)/.*#\2#; s#^git@([^:]+):.*#\1#')"
path="$(printf '%s' "$remote" | sed -E 's#^https?://[^/]+/##; s#^git@[^:]+:##; s#\.git$##')"
proj="$(printf '%s' "$path" | jq -sRr @uri)"
api="https://$host/api/v4/projects/$proj"

token="${GITLAB_TOKEN:-}"
if [ -z "$token" ]; then
  token="$(printf 'protocol=https\nhost=%s\n\n' "$host" \
    | GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=true timeout 5 git credential fill 2>/dev/null \
    | sed -n 's/^password=//p')" || true
fi
if [ -z "$token" ]; then
  echo "нет токена GitLab: задайте GITLAB_TOKEN или войдите в $host через git (git push спросит логин)" >&2
  exit 2
fi

gl() { # gl <METHOD> <url> [аргументы curl]
  local method="$1" url="$2"
  shift 2
  curl -sS --fail --max-time "${ISSUES_TIMEOUT:-15}" -X "$method" \
    -H "PRIVATE-TOKEN: $token" "$url" "$@"
}
uri() { printf '%s' "$1" | jq -sRr @uri; }
me_json() { gl GET "https://$host/api/v4/user"; }
open_issues() { gl GET "$api/issues?state=opened&per_page=100$1"; }

row='"#\(.iid) \(.title) [\(.labels | join(", "))] — \(if (.assignees | length) > 0
  then ([.assignees[].username] | join(", ")) else "свободна" end)"'

case "$cmd" in
  list)
    open_issues "${1:+&labels=$(uri "$1")}" | jq -r ".[] | $row"
    ;;
  free)
    open_issues "&assignee_id=None${1:+&labels=$(uri "$1")}" | jq -r ".[] | $row"
    ;;
  mine)
    me="$(me_json | jq -r .username)"
    open_issues "&assignee_username=$(uri "$me")" | jq -r ".[] | $row"
    ;;
  view)
    gl GET "$api/issues/${1:?номер задачи}" | jq -r '"#\(.iid) \(.title)\n\(.web_url)
состояние: \(.state); метки: \(.labels | join(", ")); исполнитель: \(
  [.assignees[].username] | join(", ") | if . == "" then "нет" else . end)\n\n\(.description // "")"'
    ;;
  take)
    n="${1:?номер задачи}"
    me="$(me_json)"
    me_id="$(printf '%s' "$me" | jq -r .id)"
    me_name="$(printf '%s' "$me" | jq -r .username)"
    issue="$(gl GET "$api/issues/$n")"
    other="$(printf '%s' "$issue" | jq -r --arg me "$me_name" \
      '[.assignees[].username | select(. != $me)] | join(", ")')"
    if [ -n "$other" ]; then
      echo "#$n уже взята: $other. Возьмите другую: bash scripts/issues.sh free" >&2
      exit 1
    fi
    area="$(printf '%s' "$issue" | jq -r '[.labels[] | select(startswith("area:"))] | first // ""')"
    if [ -n "$area" ]; then
      busy="$(open_issues "&labels=$(uri "$area")" | jq -r --arg me "$me_name" --argjson n "$n" \
        '[.[] | select(.iid != $n and (.assignees | length) > 0
          and (any(.assignees[]; .username == $me) | not))
        | "#\(.iid) \([.assignees[].username] | join(","))"] | join("; ")')"
      if [ -n "$busy" ]; then
        echo "$area занята: $busy. Та же область у двоих — конфликты в одних файлах (CLAUDE.md, «Команда»)." >&2
        echo "Договоритесь в задаче или возьмите другую область: bash scripts/issues.sh free" >&2
        exit 1
      fi
    fi
    gl PUT "$api/issues/$n" --data-urlencode "assignee_ids[]=$me_id" >/dev/null
    echo "#$n взята: $me_name. Worktree: git worktree add .claude/worktrees/$n-<тема> -b worktree-$n-<тема> origin/main"
    ;;
  create)
    title="${1:?заголовок}" labels="${2:-}" body="${3:?файл описания}"
    gl POST "$api/issues" --data-urlencode "title=$title" --data-urlencode "labels=$labels" \
      --data-urlencode "description@$body" | jq -r '"#\(.iid) \(.web_url)"'
    ;;
  comment)
    n="${1:?номер задачи}" body="${2:?файл или -}"
    gl POST "$api/issues/$n/notes" --data-urlencode "body@$body" | jq -r '"комментарий \(.id) к #'"$n"'"'
    ;;
  labels)
    have="$(gl GET "$api/labels?per_page=100" | jq -r '.[].name')"
    while IFS='|' read -r name color description; do
      if printf '%s\n' "$have" | grep -qxF -- "$name"; then continue; fi
      gl POST "$api/labels" --data-urlencode "name=$name" --data-urlencode "color=$color" \
        --data-urlencode "description=$description" >/dev/null
      echo "создана метка $name"
    done <<'LABELS'
area:model|#1971C2|Поток 1: контракты, domain, state, проверки
area:editor|#2F9E44|Поток 2: src/app, холст, инструменты плана, оборудование, свойства
area:panels|#F08C00|Поток 3: справочники, сохранение, инвентаризация, библиотека, файлы, 3D
area:assistant|#7048E8|Поток 4: расчёт рекомендаций, проверка ответа, сервер, панель ассистента
area:release|#495057|Поток 5: tooling, e2e, деплой, README и комплект защиты
P0|#E03131|Доверие или срыв основного сценария — раньше всего
P1|#F59F00|Заметно лучше для роли и защиты
P2|#ADB5BD|Только после ворот P0/P1
blocker|#C92A2A|Риск, что показ или сдача не сработает; закрыть раньше своей задачи
contract|#0C8599|Меняет src/contracts — отдельный MR через поток 1
ui|#E64980|UI-фича: обязателен UI/UX skill gate из CLAUDE.md
LABELS
    ;;
  board)
    me="$(me_json | jq -r .username)"
    all="$(open_issues "")"
    printf '%s' "$all" | jq -r '[.[] | select(any(.labels[]; . == "blocker"))] as $b
      | if ($b | length) > 0 then "[blocker] открыты — закрыть раньше своей задачи:",
          ($b[] | "  #\(.iid) \(.title)") else empty end'
    mine="$(printf '%s' "$all" | jq -r --arg me "$me" \
      '.[] | select(any(.assignees[]; .username == $me)) | "  #\(.iid) \(.title) [\(.labels | join(", "))]"')"
    if [ -n "$mine" ]; then
      echo "[issues] мои открытые ($me):"
      printf '%s\n' "$mine"
    else
      echo "[issues] за $me открытых задач нет. Взять: bash scripts/issues.sh free → bash scripts/issues.sh take <N>"
    fi
    printf '%s' "$all" | jq -r --arg me "$me" \
      '[.[] | select((.assignees | length) > 0 and (any(.assignees[]; .username == $me) | not))
        | {a: ([.labels[] | select(startswith("area:"))] | join(", ") | if . == "" then "без area" else . end),
           w: "#\(.iid) \([.assignees[].username] | join(","))"}]
      | if length > 0 then "[issues] заняты другими (задачу с той же area: не брать):",
          (group_by(.a)[] | "  \(.[0].a): \([.[].w] | join("; "))") else empty end'
    free="$(printf '%s' "$all" | jq '[.[] | select((.assignees | length) == 0)] | length')"
    echo "[issues] свободных: $free — bash scripts/issues.sh free"
    ;;
  *)
    sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
    ;;
esac
