# Legacy comparison rollback

Phase 10 removed the legacy comparison spine in two commits. The last commit
before either Phase 10 change is retained at all of these equivalent refs:

- Commit: `11315af1f135e9f5515053f48dc514a5b23303c3`
- Branch: `838-legacy-comparison-maintenance-20260817`
- Annotated tag: `legacy-comparison-final-20260817`

## Restore the retained legacy tree on a descendant release

The Phase 10 commits were squash-merged and are not reachable from `main`, so
they cannot be reverted from a fresh clone. Create a normal rollback branch
from the deployed release, fetch both retained remote anchors, and verify that
they resolve to the audited legacy boundary before restoring any files:

```bash
set -euo pipefail
LEGACY_ROLLBACK_COMMIT=11315af1f135e9f5515053f48dc514a5b23303c3
git switch -c rollback-legacy-comparison-YYYYMMDD <deployed-release>
git fetch origin \
  refs/heads/838-legacy-comparison-maintenance-20260817:refs/remotes/origin/838-legacy-comparison-maintenance-20260817 \
  refs/tags/legacy-comparison-final-20260817:refs/tags/legacy-comparison-final-20260817
test "$(git rev-parse 'legacy-comparison-final-20260817^{commit}')" = \
  "$LEGACY_ROLLBACK_COMMIT"
test "$(git rev-parse 'origin/838-legacy-comparison-maintenance-20260817^{commit}')" = \
  "$LEGACY_ROLLBACK_COMMIT"
git restore --source="$LEGACY_ROLLBACK_COMMIT" --staged --worktree -- \
  packages/docx-compare packages/docx-core packages/docx-markdoc \
  spec-compliance
git commit -m "revert(docx-compare): restore retained legacy comparison tree"
```

The annotated tag and retained branch are independent remote anchors for the
pinned restore commit. `set -euo pipefail` makes either equality check stop the
procedure if a ref has disappeared or moved. The fetch deliberately does not
force-update the local tag: a conflicting tag must stop recovery for inspection.
Using `--staged --worktree` is required because a worktree-only restore cannot
resurrect paths deleted from the current index. This restores the four audited
trees exactly as retained, including deleted legacy modules and their tests.
The Phase 10-only `scripts/check_advanced_revision_classification.test.mjs`
title change is deliberately outside this restore boundary because it has no
runtime or legacy-module coupling. Review later changes in the restored trees
before shipping, and reapply only changes independently compatible with the
legacy line. Then confirm the restored tree against the pinned commit, not the
tag name:

```bash
git diff --exit-code "$LEGACY_ROLLBACK_COMMIT" -- \
  packages/docx-compare packages/docx-core packages/docx-markdoc \
  spec-compliance
```

Run the repository pre-submit command and a real DOCX comparison smoke before
merging the rollback. Do not attempt a partial Phase 10 tree restoration: the
deleted legacy modules would then reference helpers that no longer exist.

This procedure was executed from `origin/main` at `a1566dd0` on 2026-08-21.
Both durable remote refs resolved to
`11315af1f135e9f5515053f48dc514a5b23303c3`, the restore changed 209 indexed
paths, and the documented `git diff --exit-code` command returned 0. See
[`rollback-validation.md`](rollback-validation.md) for the recorded output.

## Continue legacy maintenance directly

For an isolated hotfix that must not include the tagged-only Phase 10 history,
branch from `838-legacy-comparison-maintenance-20260817` (or the annotated tag),
apply the fix there, and ship it as a deliberately separate maintenance line.
