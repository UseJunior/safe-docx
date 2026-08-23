# Legacy rollback validation — 2026-08-22

This evidence records an actual execution of the durable remote-ref recovery
procedure. It does not claim that the restored legacy line was released. Local
validation commit identifiers are deliberately omitted because disposable
commits are not durable recovery anchors.

## Environment

- Starting revision: `origin/main` at
  `a1566dd074971150e3fdc72ed34eb70ccb2a5db7`
- Disposable worktree: `/private/tmp/safe-docx-rollback-execution-919-v3`
- Validation branch: `rollback-legacy-comparison-validation-v3-20260822`
- Restore source: pinned audited commit
  `11315af1f135e9f5515053f48dc514a5b23303c3`

## Remote-anchor and fail-closed checks

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
retained branch both resolve to the audited legacy commit. The fenced recovery
block was also exercised in separate disposable repositories with a poisoned
tag, a moved tag, a poisoned branch, and missing refs. Each case stopped before
the restore, leaving zero dirty paths and zero new commits. The unmodified
happy-path probe completed.

```text
probe                         result      dirty paths  new commits
unmodified refs               completed   0            1
poisoned local tag            non-zero    0            0
moved fetched tag             non-zero    0            0
poisoned retained branch      non-zero    0            0
missing remote anchors        non-zero    0            0
```

## Restore and exact-tree check

```text
$ git rev-parse HEAD
a1566dd074971150e3fdc72ed34eb70ccb2a5db7

$ test "$(git rev-parse 'legacy-comparison-final-20260817^{commit}')" = \
    "$LEGACY_ROLLBACK_COMMIT"
EXIT=0

$ test "$(git rev-parse 'origin/838-legacy-comparison-maintenance-20260817^{commit}')" = \
    "$LEGACY_ROLLBACK_COMMIT"
EXIT=0

$ git restore --source="$LEGACY_ROLLBACK_COMMIT" --staged --worktree -- \
    packages/docx-compare packages/docx-core packages/docx-markdoc \
    spec-compliance
EXIT=0

$ git status --short | wc -l
209

$ git diff --cached --stat
209 files changed, 39619 insertions(+), 4973 deletions(-)

$ git diff --exit-code "$LEGACY_ROLLBACK_COMMIT" -- \
    packages/docx-compare packages/docx-core packages/docx-markdoc \
    spec-compliance
EXIT=0
```

The non-zero changed-path count confirms that the exercise performed the
documented restore. The zero exit status proves that every audited tree matched
the pinned legacy commit before descendant reconciliation.

## Descendant reconciliation

The raw four-tree restore was intentionally tested before reconciliation. It
exposed three real incompatibilities with the descendant release:

- restored package manifests combined with the descendant lockfile could
  resolve published packages instead of the restored workspaces;
- the descendant MCP contract referenced the removed `atomMetricVersion` and
  `dist/tagged/` module path; and
- current spec coverage required the retained comparison specification plus
  the independently compatible configurable-note-presentation change.

The documented reconciliation commands restored the deployed workspace
manifests, retained the deployed lockfile, restored the retained MCP contract
and comparison spec, retargeted the visual test generator, regenerated tool
docs, and restored the complete note-presentation implementation, consumer, and
test set from reachable mainline commit `688d1719`. Restoring only
`note_conversion.ts` and its test was explicitly rejected after it produced
three TypeScript errors and six failing tests. The complete set built and its
88 focused docx-core tests plus 22 markdoc tests passed. `npm install` installed
617 packages with zero reported vulnerabilities.

## Descendant-change adjudication

The inventory listed 12 commits touching the restored trees between the
retained boundary and the deployed revision:

| Commit | Decision | Reason |
| --- | --- | --- |
| `dcf91216` (#896) | Drop | Tagged-serializer patch conflicts with the retained attribution serializer; an exact-file probe failed the legacy build. |
| `688d1719` (#905) | Keep completely | Independent note-presentation capability; the full runtime, consumer, and test set builds and satisfies its active spec. |
| `fe941d4d` (#898) | Drop | First Phase 10 legacy-spine deletion; this is the change being rolled back. |
| `a807a689` (#906) | Keep manifests only | Release metadata is reconciled through deployed workspace manifests. |
| `6515e70f` (#907) | Drop | Second Phase 10 tagged-only migration; this is the change being rolled back. |
| `71bf9c6f` (#908) | Drop restored-tree delta | Tagged-migration traceability is not a legacy runtime capability. |
| `274b3778` (#910) | Keep via manifest | Current docx-core test-worker serialization remains in the deployed package manifest. |
| `59d48916` (#911) | Drop from emergency line | Tagged differential manifests and corpus harness are coupled to the removed tagged-only publication surface. |
| `3340b16b` (#913) | Keep manifests only | Release metadata is reconciled through deployed workspace manifests. |
| `195b25c8` (#914) | Drop | Later coordinate refactor is not required for legacy authority and overlaps the retained document primitives. |
| `99109405` (#897) | Drop | Dual-projection package requirements are tagged-publication behavior. |
| `a1566dd0` (#928) | Drop | Bookmark-projection repair changes tagged-only construction and publication. |

## Repository gates

The complete required pre-submit sequence ran against the reconciled rollback:

```text
$ npm run build
EXIT=0

$ npm run lint:workspaces
EXIT=0

$ npm run test:run
@usejunior/docx-compare: 933 passed, 29 skipped
@usejunior/docx-core: 1364 passed, 2 expected failures, 1 skipped
@usejunior/docx-markdoc: 66 passed
@usejunior/docx-mcp: 1004 passed
All workspaces passed
EXIT=0

$ npm run check:spec-coverage
docx-comparison: 74/74 scenarios covered
add-configurable-note-presentation: 5/5 scenarios covered
All spec coverage checks passed
EXIT=0

$ npm run check:conformance-citations
EXIT=0

$ npm run check:conformance-doc
EXIT=0
```

## Real-DOCX legacy-path smoke

The restored build compared the committed public NVCA regression pair through
`compareDocumentsAtomizer(..., { comparisonStrategy: 'legacy' })`, loaded the
output as a DOCX ZIP, and checked both revision projections:

```json
{
  "engine": "atomizer",
  "comparisonStrategyRequested": "legacy",
  "comparisonStrategyUsed": "legacy",
  "acceptedMatchesRevised": true,
  "rejectedMatchesOriginal": true,
  "outputZipEntries": 31
}
```

The smoke used only the repository's public
`tests/test_documents/nvca-regression` fixtures. No private document was read or
sent to an external reviewer.
