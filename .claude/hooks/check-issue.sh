#!/usr/bin/env bash
# PreToolUse: без взятой задачи не работаем (D-299). Правка файла (Edit, Write,
# NotebookEdit) и git commit / git push через Bash разрешены только в worktree
# задачи: ветка worktree-<N>-<тема>, задача #N открыта и назначена на меня.
# Проверку делает `scripts/issues.sh check`; файлы вне репозитория (scratchpad,
# память) не проверяются. Отказ — код 2, причина уходит агенту в stderr.
set -uo pipefail

input="$(cat)"
command -v jq >/dev/null 2>&1 || exit 0
tool="$(printf '%s' "$input" | jq -r '.tool_name // ""')"

case "$tool" in
  Edit|Write|MultiEdit|NotebookEdit)
    target="$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // ""')"
    ;;
  Bash)
    cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // ""')"
    printf '%s' "$cmd" | grep -Eq '(^|[;&|(]|[[:space:]])git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+(commit|push)([[:space:]]|$)' || exit 0
    target="$(printf '%s' "$cmd" | sed -nE 's/.*git[[:space:]]+-C[[:space:]]+([^[:space:]]+)[[:space:]]+(commit|push).*/\1/p' | head -1)"
    if [ -z "$target" ]; then
      target="$(printf '%s' "$cmd" | sed -nE 's/^[[:space:]]*cd[[:space:]]+([^[:space:];&]+).*/\1/p' | head -1)"
    fi
    [ -n "$target" ] || target="$(printf '%s' "$input" | jq -r '.cwd // "."')"
    ;;
  *) exit 0 ;;
esac
[ -n "$target" ] || exit 0

script="$(cd "$(dirname "$0")/../.." && pwd)/scripts/issues.sh"
[ -f "$script" ] || exit 0
if ! reason="$(bash "$script" check "$target" 2>&1)"; then
  echo "Без взятой задачи работать нельзя (CLAUDE.md, «Команда и интеграция»; D-299). $reason" >&2
  exit 2
fi
[ -n "$reason" ] && echo "$reason" >&2
exit 0
