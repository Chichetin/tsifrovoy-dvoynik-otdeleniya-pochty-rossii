#!/usr/bin/env bash
# Финиш ветки задачи одной командой, без отдельного агента (GIT.md, «Финиш»):
# merge origin/main → build, если main ушёл вперёд → push с MR → merge MR в GitLab →
# обновление основной копии → уборка worktree. GitLab отказал (MR ещё проверяется,
# main ушёл) — до трёх попыток. Конфликт — стоп: разреши, закоммить, запусти снова.
#
#   bash scripts/finish.sh          # из worktree задачи, всё закоммичено
set -euo pipefail

die() { printf '[finish] %s\n' "$*" >&2; exit 1; }

branch="$(git branch --show-current)"
n="$(printf '%s' "$branch" | sed -n 's/^worktree-\([0-9][0-9]*\)-.*/\1/p')"
[ -n "$n" ] || die "ветка «$branch» не worktree-<N>-<тема>"
[ -z "$(git status --porcelain --untracked-files=no)" ] || die "есть незакоммиченные правки"
wt="$(git rev-parse --show-toplevel)"
main_copy="$(git worktree list --porcelain | sed -n '1s/^worktree //p')"
[ "$wt" != "$main_copy" ] || die "запускай из worktree задачи, не из основной копии"

for try in 1 2 3; do
  git fetch -q --prune
  before="$(git rev-parse HEAD)"
  git merge -q --no-edit origin/main \
    || die "конфликт с main: разреши, закоммить и запусти снова"
  if [ "$(git rev-parse HEAD)" != "$before" ]; then
    npm run build >/dev/null || die "build красный после merge origin/main"
  fi
  git push -q -u origin HEAD -o merge_request.create -o merge_request.target=main \
    -o merge_request.title="$(git log -1 --no-merges --format=%s)" \
    -o merge_request.description="Closes #$n"
  iid="$(bash scripts/gitlab-mr.sh list | grep -B2 "ветка $branch\$" | sed -n 's/^MR !\([0-9]*\).*/\1/p')"
  [ -n "$iid" ] || die "MR для $branch не найден"
  if bash scripts/gitlab-mr.sh merge "$iid"; then
    break
  fi
  [ "$try" -lt 3 ] || die "MR !$iid не влит за 3 попытки"
  sleep 10
done

cd "$main_copy"
if [ -z "$(git status --porcelain --untracked-files=no)" ]; then
  git pull -q --ff-only || echo "[finish] основная копия не обновлена: pull --ff-only не прошёл" >&2
fi
git worktree remove "$wt" || die "worktree не убран: $wt"
git branch -q -D "$branch"
git push -q origin --delete "$branch" 2>/dev/null || true
git worktree prune
echo "[finish] #$n: MR !$iid влит, worktree убран"
