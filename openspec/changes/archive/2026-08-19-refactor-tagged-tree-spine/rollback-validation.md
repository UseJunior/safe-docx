# Legacy rollback validation — 2026-08-21

This evidence records an actual execution of the durable remote-ref recovery
procedure. It does not claim that the restored legacy line was released.

## Environment

- Starting revision: `origin/main` at `a1566dd074971150e3fdc72ed34eb70ccb2a5db7`
- Disposable worktree: `/private/tmp/safe-docx-rollback-execution-919`
- Validation branch: `rollback-legacy-comparison-validation-20260821`
- Restore source: annotated tag `legacy-comparison-final-20260817`

## Remote-anchor check

```text
$ git ls-remote origin refs/heads/838-legacy-comparison-maintenance-20260817 \
    refs/tags/legacy-comparison-final-20260817 \
    'refs/tags/legacy-comparison-final-20260817^{}'
11315af1f135e9f5515053f48dc514a5b23303c3 refs/heads/838-legacy-comparison-maintenance-20260817
972cf96fed54a03aeb89958fa27c1d46b8890f21 refs/tags/legacy-comparison-final-20260817
11315af1f135e9f5515053f48dc514a5b23303c3 refs/tags/legacy-comparison-final-20260817^{}
EXIT=0
```

The first tag hash is the annotated tag object. Its peeled `^{}` value and the
retained branch both resolve to the audited legacy commit.

## Restore and exact-tree check

```text
$ git switch -c rollback-legacy-comparison-validation-20260821 origin/main
Switched to a new branch 'rollback-legacy-comparison-validation-20260821'

$ git rev-parse HEAD
a1566dd074971150e3fdc72ed34eb70ccb2a5db7

$ git fetch origin \
    refs/heads/838-legacy-comparison-maintenance-20260817:refs/remotes/origin/838-legacy-comparison-maintenance-20260817 \
    refs/tags/legacy-comparison-final-20260817:refs/tags/legacy-comparison-final-20260817
EXIT=0

$ git rev-parse 'legacy-comparison-final-20260817^{commit}'
11315af1f135e9f5515053f48dc514a5b23303c3

$ test "$(git rev-parse 'legacy-comparison-final-20260817^{commit}')" = \
    11315af1f135e9f5515053f48dc514a5b23303c3
EXIT=0

$ test "$(git rev-parse 'origin/838-legacy-comparison-maintenance-20260817^{commit}')" = \
    11315af1f135e9f5515053f48dc514a5b23303c3
EXIT=0

$ git restore --source=legacy-comparison-final-20260817 --staged --worktree -- \
    packages/docx-compare packages/docx-core packages/docx-markdoc \
    spec-compliance
EXIT=0

$ git status --short | wc -l
209

$ git diff --exit-code legacy-comparison-final-20260817 -- \
    packages/docx-compare packages/docx-core packages/docx-markdoc \
    spec-compliance
EXIT=0
```

The non-zero changed-path count confirms that the exercise performed a real
restore. The final zero exit status proves that every audited tree matched the
retained tag after the restore.
