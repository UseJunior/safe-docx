# Change: Add Markdoc header and footer authoring

## Why

Canonical Markdoc projects and edits body paragraphs, but treats relationship-
selected headers and footers as immutable package parts. A small running-text
change such as a header date therefore requires direct OOXML mutation even when
the source part, paragraph, and intended clean before/after text are all known.
The comparison pipeline likewise reports an ordinary selected-story text change
as unrepresented instead of emitting native tracked revisions.

## What Changes

- Import each existing relationship-selected header/footer physical story once,
  with an opaque stable story ID, complete semantic binding inventory, source-
  part fingerprint, and stable paragraph anchors.
- Let ordinary Markdoc paragraph replace/insert/delete operations explicitly
  target one imported side story while keeping body syntax backward-compatible.
- Compare admitted ordinary header/footer paragraph content as independent Word
  stories and emit native tracked revisions without treating run boundaries as
  authoring semantics.
- Certify accept/reject text, formatting, story bindings, and unchanged package
  parts across the body and every edited side story.
- Fail closed for new/deleted/rebound stories, ambiguous or stale story identity,
  unsupported structural changes, and external comment materialization on a
  side-story edit.

## Impact

- Affected specs: `docx-markdoc`, `docx-comparison`, `docx-primitives`,
  `mcp-server`
- Affected code: Markdoc import/IR/validation/replay/certification, selected
  ancillary-story comparison orchestration, accept/reject projection checks,
  story-scoped primitive mutation APIs, MCP acceptance wording, documentation,
  and public synthetic plus real-DOCX evidence
- Fixes one remaining capability slice under #998
- Builds on the selected-story inventory introduced by
  `compare-vml-text-box-stories`, but adds binding-closure pairing and an
  ordinary-text-blanked scaffold fingerprint rather than reusing its
  content-sensitive pairing keys
- This approval PR carries the `docx-markdoc` and `docx-comparison` deltas.
  The coverage-enforced `docx-primitives` and `mcp-server` deltas SHALL be
  added with their mapped tests in the implementation PR after approval; their
  required behavior is pinned in this design and task list.
