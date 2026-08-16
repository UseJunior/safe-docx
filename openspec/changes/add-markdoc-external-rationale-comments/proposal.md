# Change: Materialize external-facing Markdoc rationales as Word comments

## Why

Markdoc rationales are currently passive metadata and disappear from compiled DOCX output. Explicitly external-facing explanations therefore cannot travel with the tracked document for counsel review, while treating every rationale as shareable would risk exposing internal drafting context.

## What Changes

- Recognize the exact rationale category `external-facing` as the sole category eligible for native Word comment materialization.
- Add an opt-in compile configuration with explicit deterministic comment author, initials, and date.
- Anchor each selected rationale to the smallest tracked edit range attributable to its operation, with defined behavior for insertions, deletions, replacements, and multi-paragraph edits.
- Preserve accept-all, reject-all, and formatting projections when comments are materialized.
- Preserve native comment records and range markers as a balanced unit through accept-all and reject-all processing, collapsing the range deterministically when its tracked anchor is removed.
- Require independent release verification to report native comments positively when requested and to fail closed when materialization produces none.
- Require only synthetic rationale and document fixtures in this public repository.

## Impact

- Affected specs: `docx-markdoc`
- Affected code after approval: `packages/docx-markdoc` compiler/types/tests and the native-comment primitive in `packages/docx-core`, whose visible-text offset model does not currently address deleted text or cross-paragraph ranges
- Compatibility: additive and opt-in; existing Markdoc and compile calls continue to emit no rationale comments
- Tracking: Refs #860
