# Legacy comparison rollback

Phase 10 removed the legacy comparison spine in two commits. The last commit
before either Phase 10 change is retained at all of these equivalent refs:

- Commit: `11315af1f135e9f5515053f48dc514a5b23303c3`
- Branch: `838-legacy-comparison-maintenance-20260817`
- Annotated tag: `legacy-comparison-final-20260817`

## Revert the deletion on a descendant release

Create a normal rollback branch from the deployed release, then revert the two
Phase 10 commits in reverse order:

```bash
git switch -c rollback-legacy-comparison-YYYYMMDD <deployed-release>
git revert f352beaafbb9902d3ba71601b029bbe7fade299a
git revert 19d6c82617003bd00e346e1babc1c8bf24e84a0f
```

The first revert restores the legacy atom/LCS/reconstruction modules in their
post-extraction layout. The second restores their original revision-helper
ownership and removes `revisionMarkup.ts`, producing the exact tree at
`legacy-comparison-final-20260817` unless later commits overlap these files.
Resolve any such overlap in favor of the tagged rollback point, then confirm:

```bash
git diff --exit-code legacy-comparison-final-20260817 -- \
  packages/docx-compare packages/docx-core packages/docx-markdoc \
  spec-compliance
```

Run the repository pre-submit command and a real DOCX comparison smoke before
merging the rollback. Do not revert only the extraction commit: the deleted
legacy modules would then reference helpers that no longer exist.

## Continue legacy maintenance directly

For an isolated hotfix that must not include the tagged-only Phase 10 history,
branch from `838-legacy-comparison-maintenance-20260817` (or the annotated tag),
apply the fix there, and ship it as a deliberately separate maintenance line.
