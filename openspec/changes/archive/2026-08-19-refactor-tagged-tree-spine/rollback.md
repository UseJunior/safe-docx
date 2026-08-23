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
DEPLOYED_RELEASE_COMMIT=$(git rev-parse '<deployed-release>^{commit}')
git fetch origin \
  refs/heads/838-legacy-comparison-maintenance-20260817:refs/remotes/origin/838-legacy-comparison-maintenance-20260817 \
  refs/tags/legacy-comparison-final-20260817:refs/tags/legacy-comparison-final-20260817
test "$(git rev-parse 'legacy-comparison-final-20260817^{commit}')" = \
  "$LEGACY_ROLLBACK_COMMIT"
test "$(git rev-parse 'origin/838-legacy-comparison-maintenance-20260817^{commit}')" = \
  "$LEGACY_ROLLBACK_COMMIT"
git switch -c rollback-legacy-comparison-YYYYMMDD "$DEPLOYED_RELEASE_COMMIT"
git restore --source="$LEGACY_ROLLBACK_COMMIT" --staged --worktree -- \
  packages/docx-compare packages/docx-core packages/docx-markdoc \
  spec-compliance
git diff --exit-code "$LEGACY_ROLLBACK_COMMIT" -- \
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
legacy line. The exact-tree check runs against the pinned commit, not the tag
name, before the recovery-baseline commit is created.

## Reconcile the descendant release

The exact legacy tree is a recovery baseline, not yet a mergeable rollback.
Its package manifests predate the descendant release; leaving them in place can
make `npm install` fetch the published descendant packages instead of testing the
restored workspaces. The descendant MCP surface also names a metric and module
path added after the retained commit. Preserve the deployed workspace versions,
restore the three legacy-facing MCP contract files, and retarget the visual
oracle to the retained module location before installing dependencies. The
live comparison specification must return to the retained contract as well.
At the deployed revision validated below, configurable note presentation was
an independently compatible change inside the restored trees. Reapply its
complete implementation, consumer, and coverage set from its reachable mainline
commit; restoring only `note_conversion.ts` and its test does not compile.

```bash
set -euo pipefail
: "${LEGACY_ROLLBACK_COMMIT:?run the restore block first}"
: "${DEPLOYED_RELEASE_COMMIT:?run the restore block first}"
NOTE_PRESENTATION_COMMIT=688d1719c613a2a1e6fff61cefea8acec846897c
git merge-base --is-ancestor "$NOTE_PRESENTATION_COMMIT" \
  "$DEPLOYED_RELEASE_COMMIT"
git restore --source="$DEPLOYED_RELEASE_COMMIT" --staged --worktree -- \
  packages/docx-compare/package.json packages/docx-core/package.json \
  packages/docx-markdoc/package.json
git restore --source="$LEGACY_ROLLBACK_COMMIT" --staged --worktree -- \
  openspec/specs/docx-comparison/spec.md \
  packages/docx-mcp/src/tool_catalog.ts \
  packages/docx-mcp/src/tools/compare_documents_console_identity.test.ts \
  packages/docx-mcp/docs/tool-reference.generated.md
git restore --source="$NOTE_PRESENTATION_COMMIT" --staged --worktree -- \
  packages/docx-core/src/primitives/comments.test.ts \
  packages/docx-core/src/primitives/comments.ts \
  packages/docx-core/src/primitives/document.ts \
  packages/docx-core/src/primitives/footnotes.ts \
  packages/docx-core/src/primitives/index.ts \
  packages/docx-core/src/primitives/note_conversion.ts \
  packages/docx-core/src/primitives/note_conversion.test.ts \
  packages/docx-core/test-primitives/footnotes.test.ts \
  packages/docx-markdoc/src/cli.ts
perl -0pi -e \
  's{../../docx-compare/dist/tagged/trackChangesAcceptorAst\.js}{../../docx-compare/dist/baselines/atomizer/trackChangesAcceptorAst.js}g' \
  packages/docx-mcp/scripts/generate_visual_tests.mjs
! git grep -q 'dist/tagged/trackChangesAcceptorAst.js' -- \
  packages/docx-mcp/scripts/generate_visual_tests.mjs
git grep -q 'dist/baselines/atomizer/trackChangesAcceptorAst.js' -- \
  packages/docx-mcp/scripts/generate_visual_tests.mjs
npm install
npm run docs:generate:tools -w @usejunior/docx-mcp
git diff --name-status "$LEGACY_ROLLBACK_COMMIT" "$DEPLOYED_RELEASE_COMMIT" -- \
  packages/docx-compare packages/docx-core packages/docx-markdoc \
  spec-compliance
```

The inventory command lists changes added to the four restored trees between
the retained and deployed revisions. Reapply each independently compatible
change and document each intentionally dropped tagged-only or incompatible
change in the rollback PR. After that adjudication, stage and commit the
reconciliation:

```bash
set -euo pipefail
git add -- package-lock.json packages/docx-compare/package.json \
  packages/docx-core/package.json packages/docx-markdoc/package.json \
  openspec/specs/docx-comparison/spec.md \
  packages/docx-core/src/primitives/comments.test.ts \
  packages/docx-core/src/primitives/comments.ts \
  packages/docx-core/src/primitives/document.ts \
  packages/docx-core/src/primitives/footnotes.ts \
  packages/docx-core/src/primitives/index.ts \
  packages/docx-core/src/primitives/note_conversion.ts \
  packages/docx-core/src/primitives/note_conversion.test.ts \
  packages/docx-core/test-primitives/footnotes.test.ts \
  packages/docx-markdoc/src/cli.ts \
  packages/docx-mcp/src/tool_catalog.ts \
  packages/docx-mcp/src/tools/compare_documents_console_identity.test.ts \
  packages/docx-mcp/docs/tool-reference.generated.md \
  packages/docx-mcp/scripts/generate_visual_tests.mjs
git commit -m "fix(docx-compare): reconcile legacy rollback consumers"
```

Then run the repository pre-submit command and the committed, public NVCA
real-DOCX legacy-path smoke:

```bash
npm run build && npm run lint:workspaces && npm run test:run && \
  npm run check:spec-coverage && npm run check:conformance-citations && \
  npm run check:conformance-doc && \
node openspec/changes/archive/2026-08-19-refactor-tagged-tree-spine/\
check-legacy-rollback-nvca.mjs
```

Any later descendant-release reference to removed types, metrics, or
`dist/tagged/` paths must be adjudicated in the rollback PR; do not make the
gate pass by installing published descendant packages. Do not attempt a partial
Phase 10 tree restoration: the deleted legacy modules would then reference
helpers that no longer exist.

This procedure was executed from `origin/main` at `271a8cbf` on 2026-08-22.
Both durable remote refs resolved to
`11315af1f135e9f5515053f48dc514a5b23303c3`, the restore changed 209 indexed
paths before the ordered corpus-harness integration and 210 paths after it, and
the documented pinned `git diff --exit-code` command returned 0. See
[`rollback-validation.md`](rollback-validation.md) for the recorded output.

## Continue legacy maintenance directly

For an isolated hotfix that must not include the tagged-only Phase 10 history,
branch from `838-legacy-comparison-maintenance-20260817` (or the annotated tag),
apply the fix there, and ship it as a deliberately separate maintenance line.
