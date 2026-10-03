#!/usr/bin/env bash
# GitLab Issues проекта — очередь задач команды (D-298). Замена `gh issue` без glab:
# curl + jq к API того GitLab, где лежит origin. Токен — GITLAB_TOKEN, иначе из git
# credential helper для хоста origin (тот же, которым делается push). Токен не печатается.
#
#   bash scripts/issues.sh list [метка]      открытые задачи, можно по метке (area:editor, P0, blocker)
#   bash scripts/issues.sh free [метка]      открытые и никем не взятые
#   bash scripts/issues.sh mine              мои открытые
#   bash scripts/issues.sh view <N>          задача целиком
#   bash scripts/issues.sh take <N>          взять: назначить себя; занятую другим или чужую area: не берёт,
#                                            пока по ней было движение за 2 ч; иначе перехват с комментарием (D-313)
#   bash scripts/issues.sh create <заголовок> <метки через запятую> <файл описания>
#   bash scripts/issues.sh comment <N> <файл|->
#   bash scripts/issues.sh label <N> <метки через запятую>   добавить метки
#   bash scripts/issues.sh labels            создать недостающие метки команды
#   bash scripts/issues.sh board             сводка для хука начала сессии
#   bash scripts/issues.sh check [путь]      можно ли здесь работать: worktree задачи, задача моя и открыта
set -euo pipefail

cmd="${1:-help}"
[ $# -gt 0 ] && shift

# check — правило «без взятой задачи не работаем» (D-299). Проверка ветки не требует
# сети и jq; назначение задачи сверяется с GitLab и кешируется на 30 минут в git-dir
# worktree. GitLab недоступен — предупреждение, но не запрет: номер в ветке уже есть.
if [ "$cmd" = check ]; then
  target="${1:-.}"
  while [ ! -d "$target" ] && [ "$target" != / ] && [ "$target" != . ]; do target="$(dirname "$target")"; done
  git -C "$target" rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0  # вне репозитория — не наше
  home="$(cd "$(dirname "$0")" && cd "$(git rev-parse --git-common-dir)" && pwd -P)"
  cd "$target"
  [ "$(cd "$(git rev-parse --git-common-dir)" && pwd -P)" = "$home" ] || exit 0  # другой репозиторий — не наше
  branch="$(git branch --show-current 2>/dev/null || true)"
  how="Сначала задача: bash scripts/issues.sh free → take <N> → git worktree add .claude/worktrees/<N>-<тема> -b worktree-<N>-<тема> origin/main (GIT.md)"
  if [ "$(git rev-parse --absolute-git-dir)" = "$(cd "$(git rev-parse --git-common-dir)" && pwd -P)" ]; then
    echo "Основная копия ($branch): здесь файлы не меняют и не коммитят. $how" >&2
    exit 1
  fi
  n="$(printf '%s' "$branch" | sed -n 's/^worktree-\([0-9][0-9]*\)-.*/\1/p')"
  if [ -z "$n" ]; then
    echo "Ветка «$branch» без номера задачи: работа начинается только со взятой задачи. $how" >&2
    exit 1
  fi
  cache="$(git rev-parse --git-dir)/issue-check"
  if [ -f "$cache" ] && [ "$(cat "$cache")" = "$n" ] \
    && [ -z "$(find "$cache" -mmin +30 2>/dev/null)" ]; then
    exit 0
  fi
  for tool in curl jq; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      echo "[issues] нет $tool — задача #$n не сверена с GitLab; поставьте $tool (GIT.md, «Задачи»)" >&2
      exit 0
    fi
  done
  if ! verdict="$(ISSUES_TIMEOUT=4 bash "$0" verify "$n" 2>&1)"; then
    case "$verdict" in
      нет:*) echo "#$n: ${verdict#нет: }. $how" >&2; exit 1 ;;
      *) echo "[issues] GitLab недоступен — задача #$n не сверена ($verdict)" >&2; exit 0 ;;
    esac
  fi
  printf '%s' "$n" > "$cache"
  exit 0
fi

remote="$(git remote get-url origin)"
host="$(printf '%s' "$remote" | sed -E 's#^https?://([^/@]+@)?([^/]+)/.*#\2#; s#^git@([^:]+):.*#\1#')"
path="$(printf '%s' "$remote" | sed -E 's#^https?://[^/]+/##; s#^git@[^:]+:##; s#\.git$##')"
proj="$(printf '%s' "$path" | jq -sRr @uri)"
api="https://$host/api/v4/projects/$proj"

token="${GITLAB_TOKEN:-}"
if [ -z "$token" ] && [ "$cmd" != help ]; then
  token="$(printf 'protocol=https\nhost=%s\n\n' "$host" \
    | GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=true timeout 5 git credential fill 2>/dev/null \
    | sed -n 's/^password=//p')" || true
fi
if [ -z "$token" ] && [ "$cmd" != help ]; then
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

# Правило двух часов (D-313): «движение по задаче N» — самое позднее из updated_at задачи,
# updated_at её открытых MR (source_branch worktree-<N>-…) и последнего коммита в ветках
# worktree-<N>-… на сервере (API веток, без локального fetch). ISSUES_NOW и
# ISSUES_STALE_HOURS — для тестов; своё движение (PUT, комментарий) считается после проверки.
now="${ISSUES_NOW:-$(date +%s)}"
stale_h="${ISSUES_STALE_HOURS:-2}"
stale_s="$(jq -n --arg h "$stale_h" '$h | tonumber * 3600 | floor')"
gl_all() { # gl_all <url с ?…> — все страницы по 100 одним массивом. Ошибка, пустое тело,
  # не массив или больше 20 страниц — код 1: «не знаю» не должно читаться как «движения нет»
  local page=1 out='[]' chunk
  while :; do
    chunk="$(gl GET "$1&per_page=100&page=$page")" || return 1
    printf '%s' "$chunk" | jq -e 'type == "array"' >/dev/null 2>&1 || return 1
    out="$(jq -cn --argjson a "$out" --argjson b "$chunk" '$a + $b')" || return 1
    [ "$(printf '%s' "$chunk" | jq length)" -ge 100 ] || break
    [ "$page" -lt 20 ] || return 1
    page=$((page + 1))
  done
  printf '%s' "$out"
}
activity() { # activity <переменная MR> <переменная веток>: открытые MR и ветки worktree-* с сервера
  local m b
  m="$(gl_all "$api/merge_requests?state=opened")" || return 1
  b="$(gl_all "$api/repository/branches?search=$(uri '^worktree-')")" || return 1
  printf -v "$1" '%s' "$m"
  printf -v "$2" '%s' "$b"
}
moves_jq='def epoch: [capture("^(?<d>[0-9-]+T[0-9:]+)(\\.[0-9]+)?(?<z>Z|[+-][0-9]{2}:?[0-9]{2})?$")
    | (.d + "Z" | fromdateiso8601) - (if (.z // "Z") == "Z" then 0 else (.z
      | capture("(?<s>[+-])(?<h>[0-9]{2}):?(?<m>[0-9]{2})")
      | ((.h | tonumber) * 3600 + (.m | tonumber) * 60) * (if .s == "-" then -1 else 1 end)) end)]
    | first // error("дата не разобрана: \(.)");
  def prefix: "worktree-\(.iid)-";
  # Ветки этапа 1 назывались worktree-<поток>-…: ветка с последним коммитом раньше
  # создания задачи — не её ветка и движением не считается.
  def branches: prefix as $p | (.created_at // null | if . == null then 0 else epoch end) as $c
    | [$brs[] | select(.name | startswith($p)) | select(.commit.committed_date != null)
      | {n: .name, t: (.commit.committed_date | epoch)} | select(.t >= $c)];
  def moved: prefix as $p
    | ([.updated_at] + [$mrs[] | select(.source_branch | startswith($p)) | .updated_at]
      | map(select(. != null) | epoch)) + [branches[].t] | max // 0;
  def branch: branches | max_by(.t) | .n // "";
  def fresh: ($now - moved) <= $stale;
  def others($me): [.assignees[].username | select(. != $me)];
  def utc: strftime("%Y-%m-%d %H:%M UTC");
  def dur: (. / 60 | floor) as $m | "\($m / 60 | floor) ч \($m % 60) мин";'
moves() { # moves [аргументы jq] <фильтр> < json: фильтр видит moved/branch/fresh/utc/dur
  local f="${*: -1}"
  set -- "${@:1:$#-1}"
  jq -r --argjson mrs "$mrs" --argjson brs "$brs" --argjson now "$now" --argjson stale "$stale_s" \
    "$@" "$moves_jq $f"
}

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
    if ! printf '%s' "$issue" | jq -se --argjson n "$n" '
      length == 1 and (.[0] | type == "object" and .iid == $n
        and .state == "opened" and (.labels | type == "array")
        and (.assignees | type == "array"))' >/dev/null 2>&1; then
      echo "#$n: задача не прочитана или не открыта — ничего не меняю. Повторите позже." >&2
      exit 1
    fi
    if ! activity mrs brs; then
      echo "#$n: GitLab не отдал MR или ветки (ошибка, пустой ответ или больше 2000) — движение неизвестно, ничего не меняю. Повторите позже." >&2
      exit 1
    fi
    other="$(printf '%s' "$issue" | moves --arg me "$me_name" 'others($me) | join(", ")')"
    moved="$(printf '%s' "$issue" | moves 'moved')"
    branch="$(printf '%s' "$issue" | moves 'branch')"
    age=$((now - moved))
    if [ -n "$other" ] && [ "$age" -le "$stale_s" ]; then
      echo "#$n уже взята: $other; последнее движение $(moves -n "$moved | utc") ($(moves -n "$age | dur") назад)." >&2
      echo "Перехватить можно после $(moves -n "$((moved + stale_s)) | utc") (правило двух часов, D-313). Сейчас — другую: bash scripts/issues.sh free" >&2
      exit 1
    fi
    area="$(printf '%s' "$issue" | jq -r '[.labels[] | select(startswith("area:"))] | first // ""')"
    if [ -n "$area" ]; then
      busy="$(open_issues "&labels=$(uri "$area")" | moves --arg me "$me_name" --argjson n "$n" --arg area "$area" \
        '[.[] | select(.iid != $n and any(.labels[]; . == $area) and (others($me) | length) > 0
          and (any(.assignees[]; .username == $me) | not) and fresh)
        | "#\(.iid) \([.assignees[].username] | join(",")) (движение \(moved | utc))"] | join("; ")')"
      if [ -n "$busy" ]; then
        echo "$area занята: $busy. Та же область у двоих — конфликты в одних файлах (CLAUDE.md, «Как работаем»)." >&2
        echo "Договоритесь в задаче или возьмите другую область: bash scripts/issues.sh free." >&2
        echo "Без движения ${stale_h} ч область освобождается (D-313)." >&2
        exit 1
      fi
    fi
    gl PUT "$api/issues/$n" --data-urlencode "assignee_ids[]=$me_id" >/dev/null
    if [ -n "$other" ]; then
      since="$(moves -n "$moved | utc") ($(moves -n "$age | dur"))"
      note="Перехвачена $me_name у $other: без движения с $since по правилу двух часов (D-313)."
      if [ -n "$branch" ]; then note="$note Ветка: $branch — продолжаю её."; else note="$note Ветки нет."; fi
      gl POST "$api/issues/$n/notes" --data-urlencode "body=$note" >/dev/null
      echo "#$n перехвачена: $me_name (у $other, без движения с $since); комментарий в задаче оставлен."
    else
      echo "#$n взята: $me_name."
    fi
    if [ -n "$branch" ]; then
      echo "Ветка уже есть — продолжайте её, чужие коммиты не переписывать:"
      echo "  git fetch origin $branch && git worktree add .claude/worktrees/${branch#worktree-} -b $branch origin/$branch"
    else
      echo "Worktree: git worktree add .claude/worktrees/$n-<тема> -b worktree-$n-<тема> origin/main"
    fi
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
  label)
    n="${1:?номер задачи}" add="${2:?метки через запятую}"
    gl PUT "$api/issues/$n" --data-urlencode "add_labels=$add" | jq -r '"#\(.iid) [\(.labels | join(", "))]"'
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
ui|#E64980|UI-правка: сценарий в браузере, снимок, клавиатура (CLAUDE.md)
LABELS
    ;;
  verify) # для check: «нет: причина» и код 1, если задачи нет, она не открыта или не на мне
    n="${1:?номер задачи}"
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time "${ISSUES_TIMEOUT:-15}" \
      -H "PRIVATE-TOKEN: $token" "$api/issues/$n" 2>/dev/null)" || true
    case "$code" in
      404) echo "нет: задачи #$n в проекте нет"; exit 1 ;;
      401|403) echo "нет: GitLab отказал в доступе ($code) — проверьте токен"; exit 1 ;;
    esac
    me="$(me_json | jq -r .username)"
    issue="$(gl GET "$api/issues/$n")"
    state="$(printf '%s' "$issue" | jq -r .state)"
    [ "$state" = opened ] || { echo "нет: задача $state, а не открыта"; exit 1; }
    printf '%s' "$issue" | jq -e --arg me "$me" 'any(.assignees[]; .username == $me)' >/dev/null \
      || { echo "нет: не назначена на $me (bash scripts/issues.sh take $n)"; exit 1; }
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
    known=true
    activity mrs brs 2>/dev/null || { known=false mrs='[]' brs='[]'; }
    printf '%s' "$all" | moves '[.[] | moved] | length' >/dev/null 2>&1 || known=false
    printf '%s' "$all" | moves --arg me "$me" --argjson known "$known" \
      '[.[] | select((.assignees | length) > 0 and (any(.assignees[]; .username == $me) | not)
          and (($known | not) or fresh))
        | {a: ([.labels[] | select(startswith("area:"))] | join(", ") | if . == "" then "без area" else . end),
           w: "#\(.iid) \([.assignees[].username] | join(","))"}]
      | if length > 0 then "[issues] заняты другими (задачу с той же area: не брать):",
          (group_by(.a)[] | "  \(.[0].a): \([.[].w] | join("; "))") else empty end'
    if [ "$known" = true ]; then
      printf '%s' "$all" | moves --arg me "$me" --arg h "$stale_h" \
        '[.[] | select((.assignees | length) > 0 and (any(.assignees[]; .username == $me) | not)
            and (fresh | not))
          | "#\(.iid) \([.assignees[].username] | join(",")), \(($now - moved) / 3600 | floor) ч"]
        | if length > 0 then "[issues] можно перехватить (без движения > \($h) ч): \(join("; "))"
          + " — take <N>, продолжать ветку задачи (D-313)" else empty end'
    fi
    free="$(printf '%s' "$all" | jq '[.[] | select((.assignees | length) == 0)] | length')"
    echo "[issues] свободных: $free — bash scripts/issues.sh free"
    ;;
  *)
    sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
    ;;
esac
