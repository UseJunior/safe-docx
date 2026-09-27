# Change: Name Markdoc edits with `edit=` instead of `operation=`

## Why

The `operation=` attribute holds the name of an edit (`add-cure-period`), but
reads as the kind of edit (rename, rewrite), while `id=` on the same tag is the
source paragraph. Agents that read it as a verb vocabulary reuse names, so the
parser rejects duplicates or rationales bind to the wrong edit.

## What Changes

- `edit=` names the edit on `change`, `replace-source`, `delete-source`,
  `insert-before`, `insert-after`, `insert-table-rows`, `delete-table-row` and
  (optionally) `annotation`; `change-set` takes `edits=`. `rationale for=` and
  `requirement satisfied-by=` keep pointing at that name.
- The former `operation=`/`operations=` spelling is accepted for one minor
  version with a non-fatal `DEPRECATED_EDIT_ATTRIBUTE` warning; both spellings
  on one tag fail with `CONFLICTING_EDIT_ATTRIBUTES`.
- Validation exposes warnings separately from issues; compilation records them
  in the certificate and the CLI prints them to stderr.
- Import emits only `edit=`.
- Validation codes that named operations now name edits (`DUPLICATE_EDIT`,
  `ORPHAN_ANNOTATION_EDIT`, `MISSING_EDIT_NAME`, and the requirement and
  change-set variants). No package in this repository matched on the old codes.

## Impact

- Affected specs: docx-markdoc
- Affected code: `packages/docx-markdoc/src/markdoc.ts`, `types.ts`,
  `compile.ts`, `cli.ts`, `import.ts`, README, tests
- Related issue: #1104
