# Change: Preserve existing revisions during annotation projection

## Why

Canonical annotation recompilation currently rejects any anchored source that
already contains tracked revisions. Annotation-only work must not require a
destructive accept/reject preprocessing step.

## What Changes

- Admit annotation-only compilation from sources with existing revisions.
- Preserve existing revision XML and story placement exactly while projecting annotations.
- Verify annotation output against the source's own accept/reject projections.
- Continue to fail closed when operative text edits are mixed with existing revisions.

## Impact

- Affected specs: `docx-markdoc`
- Affected code: `packages/docx-markdoc/src/compile.ts`, certificate types, and annotation regression tests
- Compatibility: the former blanket refusal becomes a narrowly admitted annotation-only path

