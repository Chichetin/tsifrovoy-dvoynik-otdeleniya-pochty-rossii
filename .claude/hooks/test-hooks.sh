#!/usr/bin/env bash
# Проверка Stop-хуков на временном git-репозитории: bash .claude/hooks/test-hooks.sh
set -uo pipefail

HOOKS="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP" && git init -q . && mkdir -p .claude
FAIL=0

expect() { # expect <block|pass> <описание> <хук>
  local out
  out="$(bash "$HOOKS/$3" 2>&1)"
  if [ "$1" = block ] && ! printf '%s' "$out" | grep -q '"decision": *"block"'; then
    echo "FAIL: $2 — ожидалась блокировка, вывод: $out"; FAIL=1
  elif [ "$1" = pass ] && [ -n "$out" ]; then
    echo "FAIL: $2 — ожидался пустой вывод, вывод: $out"; FAIL=1
  else
    echo "ok:   $2"
  fi
}

# --- check-secrets.sh
expect pass  "чистый репозиторий"                   check-secrets.sh
echo 'LLM_API_KEY=your_api_key_here' > .env.example
expect pass  ".env.example с плейсхолдером"         check-secrets.sh
echo 'const token = "f9a8Xc72kLmQ01zYvB3n4dHs"' > bot.js
expect block "токен в коде"                         check-secrets.sh
echo 'const token = "f9a8Xc72kLmQ01zYvB3n4dHs" // secret-scan: allow' > bot.js
expect pass  "строка с явным secret-scan: allow"    check-secrets.sh
rm bot.js
echo 'client = OpenAI(api_key="sk-3f9a8c72b1d04e6fa9b7c2d5e8f10a4b")' > llm.py
expect block "ключ LLM в коде"                      check-secrets.sh
rm llm.py
echo 'LLM_API_KEY=abc' > .env
expect block ".env не в .gitignore"                 check-secrets.sh
echo '.env' > .gitignore
expect pass  ".env в .gitignore"                    check-secrets.sh
printf -- '-----BEGIN RSA PRIVATE KEY-----\n' > key.pem
expect block "приватный ключ"                       check-secrets.sh
rm key.pem

# --- session-context.sh (SessionStart: stdout уходит в контекст)
expect_out() { # expect_out <has|lacks> <описание> <шаблон>
  local out
  out="$(bash "$HOOKS/session-context.sh" 2>&1)"
  if [ "$1" = has ] && ! printf '%s' "$out" | grep -q -- "$3"; then
    echo "FAIL: $2 — нет «$3», вывод: $out"; FAIL=1
  elif [ "$1" = lacks ] && printf '%s' "$out" | grep -q -- "$3"; then
    echo "FAIL: $2 — лишнее «$3», вывод: $out"; FAIL=1
  else
    echo "ok:   $2"
  fi
}
git checkout -q -b main 2>/dev/null
mkdir -p scripts "$TMP/bin" && cp "$HOOKS/../../scripts/issues.sh" scripts/
git remote add origin https://gitlab.example/team/plan.git
git add scripts && git -c user.name=t -c user.email=t@t commit -q -m init
expect_out has   "основная копия на main — предупреждение" "основной копии"
expect_out lacks "нет токена — без падения и без задач"     "мои открытые"
cat > "$TMP/bin/curl" <<'CURL'
#!/usr/bin/env bash
[ -n "${CURL_FAIL:-}" ] && exit 7
[ -n "${CURL_LOG:-}" ] && printf '%s\n' "$*" >> "$CURL_LOG"
case "$*" in
  *"-X GET "*/issues/21*)
    if [ -n "${CURL_ISSUE_MODE:-}" ]; then
      case "$CURL_ISSUE_MODE" in
        empty) ;;
        null) echo 'null' ;;
        array) echo '[]' ;;
        object) echo '{"message": "proxy"}' ;;
        wrong) echo '{"iid": 99, "state": "opened", "labels": [], "assignees": []}' ;;
        multiple) printf '%s\n' '{"iid": 21, "state": "opened", "labels": [], "assignees": []}' '{"iid": 21, "state": "opened", "labels": [], "assignees": []}' ;;
      esac
      exit 0
    fi ;;
  *merge_requests*) [ -n "${CURL_MR_EXIT:-}" ] && exit "$CURL_MR_EXIT"
    [ -n "${CURL_MR_EMPTY:-}" ] && exit 0
    [ -n "${CURL_MR_PARTIAL:-}" ] && { echo '[]'; exit 18; } ;;
  *repository/branches*) [ -n "${CURL_BR_EXIT:-}" ] && exit "$CURL_BR_EXIT"
    [ -n "${CURL_BR_OBJECT:-}" ] && { echo '{"message": "proxy"}'; exit 0; }
    [ -n "${CURL_BR_NULL:-}" ] && { echo 'null'; exit 0; }
    [ -n "${CURL_BR_FULL:-}" ] && { jq -cn '[range(100) | {name: "b\(.)", commit: {committed_date: "2026-09-29T10:00:00Z"}}]'; exit 0; } ;;
esac
case "$*" in
  *http_code*/issues/15*) printf 404; exit 0 ;;
  *http_code*) printf 200; exit 0 ;;
esac
case "$*" in
  *PUT*) echo '{}' ;;
  *POST*/notes*) echo '{"id": 1}' ;;
  *merge_requests*) echo '[{"source_branch": "worktree-17-y", "updated_at": "2026-09-29T19:00:00.000Z"}]' ;;
  *repository/branches*) echo '[{"name": "worktree-13-old", "commit": {"committed_date": "2026-09-29T12:00:00Z"}},
    {"name": "worktree-24-stage1", "commit": {"committed_date": "2026-09-21T10:00:00Z"}},
    {"name": "worktree-13-x", "commit": {"committed_date": "2026-09-29T20:10:00.000+03:00"}},
    {"name": "worktree-18-z", "commit": {"committed_date": "2026-09-29T19:50:00.000Z"}}]' ;;
  */issues/16*) echo '{"iid": 16, "state": "opened", "labels": ["area:assistant"], "assignees": []}' ;;
  */api/v4/user*) echo '{"id": 1, "username": "me"}' ;;
  */issues/12*) echo '{"iid": 12, "state": "opened", "assignees": [{"username": "me"}]}' ;;
  */issues/13*) echo '{"iid": 13, "state": "opened", "labels": [], "created_at": "2026-09-29T09:00:00.000Z", "updated_at": "2026-09-29T17:10:00.000Z", "assignees": [{"username": "mate"}]}' ;;
  */issues/22*) echo '{"iid": 22, "state": "opened", "labels": [], "updated_at": "2026-09-29 10:00", "assignees": [{"username": "mate"}]}' ;;
  */issues/23*) echo '{"iid": 23, "state": "opened", "labels": [], "updated_at": "2026-09-29T18:05:00Z", "assignees": [{"username": "mate"}]}' ;;
  */issues/24*) echo '{"iid": 24, "state": "opened", "labels": [], "created_at": "2026-09-29T08:00:00Z", "updated_at": "2026-09-29T10:00:00Z", "assignees": [{"username": "mate"}]}' ;;
  */issues/17*) echo '{"iid": 17, "state": "opened", "labels": [], "updated_at": "2026-09-29T17:00:00.000Z", "assignees": [{"username": "mate"}]}' ;;
  */issues/18*) echo '{"iid": 18, "state": "opened", "labels": [], "updated_at": "2026-09-29T16:00:00.000Z", "assignees": [{"username": "mate"}]}' ;;
  */issues/21*) echo '{"iid": 21, "state": "opened", "labels": ["area:model"], "updated_at": "2026-09-29T20:00:00.000Z", "assignees": []}' ;;
  */issues/14*) echo '{"iid": 14, "state": "closed", "assignees": [{"username": "me"}]}' ;;
  */issues*) cat <<'JSON'
[{"iid": 3, "title": "Направляющие при перетаскивании", "labels": ["area:editor", "P1"], "assignees": [{"username": "me"}]},
 {"iid": 5, "title": "Проверка чата", "labels": ["area:assistant", "P0"], "updated_at": "2026-09-29T19:30:00.000Z", "assignees": [{"username": "mate"}]},
 {"iid": 20, "title": "Брошенная модель", "labels": ["area:model"], "updated_at": "2026-09-29T10:00:00.000Z", "assignees": [{"username": "gone"}]},
 {"iid": 7, "title": "Никем не взята", "labels": ["area:panels"], "assignees": []},
 {"iid": 9, "title": "Демо не открывается", "labels": ["blocker", "area:release"], "assignees": []}]
JSON
  ;;
esac
CURL
chmod +x "$TMP/bin/curl"
export PATH="$TMP/bin:$PATH" GITLAB_TOKEN=test-token
# «Сейчас» для правила двух часов (D-313): 29.09 20:05 UTC
export ISSUES_NOW="$(jq -n '"2026-09-29T20:05:00Z" | fromdateiso8601')"
expect_out has   "мои задачи видны"                          "#3 Направляющие при перетаскивании"
expect_out has   "занятая другим область видна"              "area:assistant: #5 mate"
expect_out lacks "свободная задача не считается занятой"     "area:panels:"
expect_out has   "blocker виден"                             "#9 Демо не открывается"
expect_out lacks "обычная задача не считается blocker"       "  #7 Никем не взята"
expect_out has   "board: кандидат на перехват"               "можно перехватить (без движения > 2 ч): #20 gone, 10 ч"
expect_out lacks "board: свежая чужая задача — не кандидат"  "#5 mate, "
expect_out lacks "board: брошенная area: не занята"          "area:model: #20"
CURL_FAIL=1 expect_out has "GitLab недоступен — предупреждение, без падения" "GitLab недоступен"
git worktree add -q .claude/worktrees/wt-test -b worktree-wt-test 2>/dev/null
(cd .claude/worktrees/wt-test && expect_out lacks "worktree — без предупреждения" "основной копии")
(cd .claude/worktrees/wt-test && expect_out has   "worktree — видна ветка"        "worktree-wt-test")

# --- check-issue.sh (PreToolUse: без взятой задачи не работаем, D-299)
expect_pre() { # expect_pre <block|pass> <описание> <json>
  local out code
  out="$(printf '%s' "$3" | bash "$HOOKS/check-issue.sh" 2>&1)"; code=$?
  if [ "$1" = block ] && [ "$code" != 2 ]; then
    echo "FAIL: $2 — ожидался отказ (код 2), код $code, вывод: $out"; FAIL=1
  elif [ "$1" = pass ] && [ "$code" != 0 ]; then
    echo "FAIL: $2 — ожидался пропуск, код $code, вывод: $out"; FAIL=1
  else
    echo "ok:   $2"
  fi
}
edit() { printf '{"tool_name":"Edit","tool_input":{"file_path":"%s"}}' "$1"; }
for n in 12 13 14; do git worktree add -q ".claude/worktrees/$n-x" -b "worktree-$n-x" 2>/dev/null; done
expect_pre block "правка в основной копии"              "$(edit "$TMP/src/a.ts")"
expect_pre block "ветка без номера задачи"              "$(edit "$TMP/.claude/worktrees/wt-test/a.ts")"
expect_pre pass  "моя открытая задача"                  "$(edit "$TMP/.claude/worktrees/12-x/src/new/a.ts")"
expect_pre block "задача назначена на другого"          "$(edit "$TMP/.claude/worktrees/13-x/a.ts")"
expect_pre block "задача закрыта"                       "$(edit "$TMP/.claude/worktrees/14-x/a.ts")"
expect_pre pass  "файл вне репозитория"                 "$(edit /tmp/scratch-note.md)"
expect_pre block "git commit в основной копии"          "{\"tool_name\":\"Bash\",\"cwd\":\"$TMP\",\"tool_input\":{\"command\":\"git add a && git commit -m x\"}}"
expect_pre pass  "git commit в worktree задачи через -C" "{\"tool_name\":\"Bash\",\"cwd\":\"$TMP\",\"tool_input\":{\"command\":\"git -C $TMP/.claude/worktrees/12-x commit -m x\"}}"
expect_pre pass  "обычная команда Bash не проверяется"  "{\"tool_name\":\"Bash\",\"cwd\":\"$TMP\",\"tool_input\":{\"command\":\"git status\"}}"
rm -f "$(git -C .claude/worktrees/13-x rev-parse --git-dir)/issue-check"
CURL_FAIL=1 expect_pre pass "GitLab недоступен — номер в ветке есть, пропуск с предупреждением" "$(edit "$TMP/.claude/worktrees/13-x/a.ts")"
bashcmd() { jq -cn --arg cwd "$1" --arg c "$2" '{tool_name: "Bash", cwd: $cwd, tool_input: {command: $c}}'; }
git worktree add -q .claude/worktrees/15-x -b worktree-15-x 2>/dev/null
expect_pre block "задачи с таким номером нет (404)"      "$(edit "$TMP/.claude/worktrees/15-x/a.ts")"
expect_pre pass  "git push внутри heredoc — это данные"   "$(bashcmd "$TMP" "$(printf 'cat > /tmp/b.md <<EOF\nпотом git push\nEOF')")"
expect_pre pass  "git -C \"путь\" commit в кавычках"     "$(bashcmd "$TMP" "git -C \"$TMP/.claude/worktrees/12-x\" commit -m x")"
expect_pre pass  "удаление ветки push --delete — уборка"  "$(bashcmd "$TMP" "git -C $TMP push origin --delete worktree-12-x")"
mkdir -p "$TMP/other" && git -C "$TMP/other" init -q
expect_pre pass  "другой репозиторий — не наш"            "$(edit "$TMP/other/a.ts")"
if printf 'refs/heads/x 0000000000000000000000000000000000000000 refs/heads/x abc\n' | bash "$HOOKS/../../.githooks/pre-push" origin url >/dev/null 2>&1; then
  echo "ok:   pre-push: удаление ветки пропускается"
else echo "FAIL: pre-push: удаление ветки заблокировано"; FAIL=1; fi
if printf 'refs/heads/main abc123 refs/heads/main def456\n' | bash "$HOOKS/../../.githooks/pre-push" origin url >/dev/null 2>&1; then
  echo "FAIL: pre-push: обычный push из основной копии пропущен"; FAIL=1
else echo "ok:   pre-push: обычный push из основной копии отклонён"; fi
if out="$(bash scripts/issues.sh take 16 2>&1)"; then
  echo "FAIL: take: занятая area: не остановила, вывод: $out"; FAIL=1
elif printf '%s' "$out" | grep -q "area:assistant занята"; then echo "ok:   take: занятая area: — отказ"
else echo "FAIL: take: неожиданный отказ: $out"; FAIL=1; fi
# --- take по правилу двух часов (D-313): движение = задача, её MR, её ветка
take_case() { # take_case <refuse|take> <описание> <N> [шаблон вывода]
  local out code
  : > "$TMP/curl.log"
  out="$(CURL_LOG="$TMP/curl.log" bash scripts/issues.sh take "$3" 2>&1)"; code=$?
  local put note
  put="$(grep -c -- "-X PUT .*/issues/$3 " "$TMP/curl.log")"
  note="$(grep -c -- "-X POST .*/issues/$3/notes" "$TMP/curl.log")"
  if [ "$1" = refuse ] && { [ "$code" = 0 ] || [ "$put" != 0 ] || [ "$note" != 0 ]; }; then
    echo "FAIL: $2 — ожидался отказ без PUT/notes (код $code, PUT $put, notes $note), вывод: $out"; FAIL=1
  elif [ "$1" = take ] && { [ "$code" != 0 ] || [ "$put" != 1 ]; }; then
    echo "FAIL: $2 — ожидалось назначение (код $code, PUT $put), вывод: $out"; FAIL=1
  elif [ -n "${4:-}" ] && ! printf '%s' "$out" | grep -q -- "$4"; then
    echo "FAIL: $2 — нет «$4», вывод: $out"; FAIL=1
  else
    echo "ok:   $2"
  fi
}
for mode in empty null array object wrong multiple; do
  CURL_ISSUE_MODE="$mode" take_case refuse "take: нечитаемая задача ($mode) — без назначения и комментария" 21 "задача не прочитана"
done
take_case refuse "take: чужая, свежий MR (1 ч 5 мин) — отказ"      17 "Перехватить можно после 2026-09-29 21:00 UTC"
take_case refuse "take: чужая, свежий коммит в ветке — отказ"      18 "2026-09-29 19:50 UTC"
take_case take   "take: чужая без движения 2 ч 55 мин — перехват" 13 "git worktree add .claude/worktrees/13-x -b worktree-13-x origin/worktree-13-x"
if grep -q -- "-X POST .*/issues/13/notes" "$TMP/curl.log" \
  && grep -q "без движения с 2026-09-29 17:10 UTC (2 ч 55 мин)" "$TMP/curl.log" \
  && grep -q "Ветка: worktree-13-x" "$TMP/curl.log"; then
  echo "ok:   take: перехват оставил комментарий с временем и веткой"
else echo "FAIL: take: нет комментария перехвата, лог: $(cat "$TMP/curl.log")"; FAIL=1; fi
CURL_MR_EXIT=22 take_case refuse "take: MR не прочитались (exit 22) — просроченная #13 не перехватывается" 13 "движение неизвестно"
CURL_BR_EXIT=28 take_case refuse "take: ветки не прочитались (exit 28) — не перехватывается" 13 "движение неизвестно"
CURL_MR_EMPTY=1 take_case refuse "take: пустое тело 200 вместо MR — не перехватывается" 13 "движение неизвестно"
CURL_BR_OBJECT=1 take_case refuse "take: объект вместо массива веток — не перехватывается" 13 "движение неизвестно"
CURL_BR_NULL=1 take_case refuse "take: null вместо массива веток — не перехватывается" 13 "движение неизвестно"
CURL_MR_PARTIAL=1 take_case refuse "take: curl упал после «[]» (exit 18) — не перехватывается" 13 "движение неизвестно"
CURL_BR_FULL=1 take_case refuse "take: больше 20 страниц веток — ошибка, не усечение" 13 "движение неизвестно"
take_case refuse "take: неразобранная дата — отказ, а не «давно»" 22 "дата не разобрана"
take_case refuse "take: ровно 2 ч без движения — ещё отказ" 23 "2026-09-29 18:05 UTC"
take_case take   "take: ветка этапа 1 старше задачи — не её ветка" 24 "origin/main"
if grep -q "worktree-24-stage1" "$TMP/curl.log"; then
  echo "FAIL: take: ветка старше задачи попала в комментарий"; FAIL=1
else echo "ok:   take: ветка старше задачи не попала в комментарий"; fi
ISSUES_STALE_HOURS=3 take_case refuse "take: порог ISSUES_STALE_HOURS=3 — те же 2 ч 55 мин свежие" 13
take_case take   "take: area:model занята, но без движения 10 ч — не блокирует" 21
if grep -q -- "-X POST .*/issues/21/notes" "$TMP/curl.log"; then
  echo "FAIL: take: свободная задача получила комментарий перехвата"; FAIL=1
else echo "ok:   take: свободная задача берётся без комментария перехвата"; fi

# --- check-worktrees.sh (SubagentStop: секреты во всех worktree)
expect pass  "worktrees: секретов нигде нет"           check-worktrees.sh
echo 'const token = "f9a8Xc72kLmQ01zYvB3n4dHs"' > .claude/worktrees/wt-test/bot.js
expect block "worktrees: секрет в чужом worktree"       check-worktrees.sh
out="$(bash "$HOOKS/check-worktrees.sh" 2>&1)"
if printf '%s' "$out" | grep -q 'worktree .*wt-test'; then echo "ok:   worktrees: в причине назван worktree"
else echo "FAIL: worktrees: worktree не назван, вывод: $out"; FAIL=1; fi
rm .claude/worktrees/wt-test/bot.js
expect pass  "worktrees: после удаления секрета чисто"  check-worktrees.sh

# --- check-upstream.sh: чужие коммиты в origin/main против моей работы
cd "$TMP" && git init -q --bare -b main remote.git
git clone -q remote.git mate 2>/dev/null
mate_push() { # mate_push <файл> <сообщение>
  (cd "$TMP/mate" && echo "$2" >> "$1" && git add "$1" &&
   git -c user.name=mate -c user.email=m@m commit -q -m "$2" && git push -q origin HEAD:main)
}
mate_push README.md "init"
git clone -q remote.git me && cd me && git checkout -q -b worktree-me origin/main
expect_up() { # expect_up <block|pass> <описание> [шаблон]
  local out
  out="$(echo '{}' | bash "$HOOKS/check-upstream.sh" stop 2>&1)"
  if [ "$1" = block ] && ! { printf '%s' "$out" | grep -q '"decision": *"block"' &&
                            printf '%s' "$out" | grep -q -- "$3"; }; then
    echo "FAIL: $2 — ожидалась блокировка с «$3», вывод: $out"; FAIL=1
  elif [ "$1" = pass ] && [ -n "$out" ]; then
    echo "FAIL: $2 — ожидался пустой вывод, вывод: $out"; FAIL=1
  else
    echo "ok:   $2"
  fi
}
expect_up pass  "upstream: новых коммитов нет"
mate_push other.txt "editor: чужой файл"
expect_up pass  "upstream: чужой коммит не пересекается с моими файлами"
echo mine > shared.txt
mate_push shared.txt "api: тот же файл"
expect_up block "upstream: пересечение с незакоммиченным файлом" "shared.txt"
expect_up pass  "upstream: то же состояние origin/main второй раз не блокирует"
echo mine > new.txt && git add new.txt && git -c user.name=me -c user.email=me@me commit -q -m wip
mate_push new.txt "model: тот же новый файл"
expect_up block "upstream: пересечение с закоммиченным в ветке файлом" "new.txt"
mate_push HANDOFF.md "docs: взял задачу"
expect_up block "upstream: изменился HANDOFF — показать всегда" "HANDOFF.md"
mate_push shared.txt "api: ещё правка"
out="$(echo '{}' | bash "$HOOKS/check-upstream.sh" post 2>&1)"
if printf '%s' "$out" | jq -e '.hookSpecificOutput.additionalContext | contains("shared.txt")' >/dev/null 2>&1; then
  echo "ok:   upstream post: факты в additionalContext без блокировки"
else echo "FAIL: upstream post: нет additionalContext, вывод: $out"; FAIL=1; fi
mate_push shared.txt "api: третья правка"
out="$(echo '{}' | bash "$HOOKS/check-upstream.sh" post 2>&1)"
if [ -z "$out" ]; then echo "ok:   upstream post: не чаще раза в 5 минут"
else echo "FAIL: upstream post: сработал раньше 5 минут, вывод: $out"; FAIL=1; fi
git remote set-url origin "$TMP/nope.git"
expect_up pass  "upstream: сеть недоступна — молчит"

exit $FAIL
