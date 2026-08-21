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
git switch -c rollback-legacy-comparison-YYYYMMDD <deployed-release>
git fetch origin \
  refs/heads/838-legacy-comparison-maintenance-20260817:refs/remotes/origin/838-legacy-comparison-maintenance-20260817 \
  refs/tags/legacy-comparison-final-20260817:refs/tags/legacy-comparison-final-20260817
test "$(git rev-parse 'legacy-comparison-final-20260817^{commit}')" = \
  11315af1f135e9f5515053f48dc514a5b23303c3
test "$(git rev-parse 'origin/838-legacy-comparison-maintenance-20260817^{commit}')" = \
  11315af1f135e9f5515053f48dc514a5b23303c3
git restore --source=legacy-comparison-final-20260817 --staged --worktree -- \
  packages/docx-compare packages/docx-core packages/docx-markdoc \
  spec-compliance
git commit -m "revert(docx-compare): restore retained legacy comparison tree"
```

The annotated tag is the restore source; the retained branch is an independent
remote anchor for the same commit. Both equality checks intentionally stop the
procedure if either ref has disappeared or moved. Using `--staged --worktree`
is required because a worktree-only restore cannot resurrect paths deleted from
the current index. This restores the four audited trees exactly as retained,
including deleted legacy modules and their tests. Review later changes in those
trees before shipping, and reapply only changes independently compatible with
the legacy line. Then confirm the restored tree:

```bash
git diff --exit-code legacy-comparison-final-20260817 -- \
  packages/docx-compare packages/docx-core packages/docx-markdoc \
  spec-compliance
```

Run the repository pre-submit command and a real DOCX comparison smoke before
merging the rollback. Do not revert only the extraction commit: the deleted
legacy modules would then reference helpers that no longer exist.

This procedure was executed from `origin/main` at `a1566dd0` on 2026-08-21.
Both durable remote refs resolved to
`11315af1f135e9f5515053f48dc514a5b23303c3`, the restore changed 209 indexed
paths, and the documented `git diff --exit-code` command returned 0. See
[`rollback-validation.md`](rollback-validation.md) for the recorded output.

## Continue legacy maintenance directly

For an isolated hotfix that must not include the tagged-only Phase 10 history,
branch from `838-legacy-comparison-maintenance-20260817` (or the annotated tag),
apply the fix there, and ship it as a deliberately separate maintenance line.
