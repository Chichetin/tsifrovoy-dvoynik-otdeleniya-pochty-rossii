#!/usr/bin/env bash
# SessionStart: stdout попадает в контекст сессии. Показывает, где агент стоит в Git,
# предупреждает о работе в основной копии на main, выводит открытые blocker, мои задачи и
# занятые области из GitLab Issues (D-298). Реестр занятости — Issues, не HANDOFF.md.
# Ничего не блокирует. Нет токена или сети — одна строка предупреждения.
set -uo pipefail

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

branch="$(git branch --show-current 2>/dev/null)"
dirty="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
echo "[git] ветка: ${branch:-detached}; незакоммиченных путей: $dirty; $(git rev-parse --show-toplevel)"

# В связанном worktree git-dir и git-common-dir различаются.
if [ "$(git rev-parse --git-dir)" = "$(git rev-parse --git-common-dir)" ] && [ "$branch" = main ]; then
  echo "[git] ВНИМАНИЕ: ты в основной копии на main. Задачу, меняющую файлы, делай в своём worktree:"
  echo "      bash scripts/issues.sh take <N>, затем git worktree add .claude/worktrees/<N>-<тема> -b worktree-<N>-<тема> origin/main (GIT.md)"
  [ "$dirty" != 0 ] && echo "      Незакоммиченные изменения здесь могут быть чужими — не коммить и не трогай их."
fi

[ -f scripts/issues.sh ] || exit 0
if ! ISSUES_TIMEOUT=4 timeout 8 bash scripts/issues.sh board 2>/dev/null; then
  echo "[issues] GitLab недоступен или нет токена — занятость не видна (bash scripts/issues.sh mine)."
fi
exit 0
