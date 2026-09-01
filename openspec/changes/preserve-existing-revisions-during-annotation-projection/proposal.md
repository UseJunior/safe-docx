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
- Compatibility: the former blanket refusal becomes a narrowly admitted annotation-only path. Two consequences are deliberate:
  - Detection now covers every revision container accept/reject resolves (including the six property-change kinds) across document, header, footer, footnote, endnote, and comment stories, instead of `w:ins|w:del|w:moveFrom|w:moveTo` in `word/document.xml` only. A source whose only revision is, for example, a `w:pPrChange`, or whose only `w:ins` sits in a footer, previously compiled operative edits and now fails closed with `EXISTING_REVISIONS_WITH_OPERATIVE_EDITS_UNSUPPORTED`.
  - Annotations whose range markers or reference run lie inside an existing revision container (a comment on, spanning, or starting at the end of inserted text) fail closed with `ANNOTATION_REVISION_TOPOLOGY_UNSUPPORTED`, because projection re-emits annotations by delete-and-re-add and cannot reproduce the container byte-for-byte. Editing such annotations in place is tracked in #960.
- Known gap: projection still wraps each re-emitted root comment reference in a tracked `w:ins` carrying the comment date, so `projectedRevisionCount` exceeds `existingRevisionCount` by the number of re-emitted root comments; the preservation check is therefore ordered containment per story, not equality. Tracked in #961.
- Revisions inside comment and footnote bodies are already rejected at import, so the ancillary-story coverage effectively applies to headers and footers.

