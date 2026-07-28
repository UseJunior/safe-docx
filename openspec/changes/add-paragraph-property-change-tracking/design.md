## Context

Run-format comparison is atom-level: equal text atoms are compared through
their `w:rPr` ancestors and changed atoms drive `w:rPrChange` emission.
Paragraph style is shared by every atom in a paragraph, and an empty paragraph
has only its boundary atom. Treating a paragraph-style change as one change per
atom would overcount non-empty paragraphs, allocate duplicate revisions, and
make behavior depend on run fragmentation.

Both reconstruction paths already know how to emit or preserve
`w:pPrChange`, and accept/reject already understands the element. The missing
contract is a paragraph-level comparison result that both paths consume.

## Goals / Non-Goals

### Goals

- Detect an explicit `w:pStyle` reference change once per aligned paragraph.
- Support aligned empty and non-empty paragraphs through the same path.
- Emit schema-ordered `w:pPrChange` with the original properties as its
  snapshot and revised properties as the live state.
- Give inplace and rebuild equivalent accept/reject projections.
- Define deterministic `ignoreFormatting` behavior.
- Avoid phantom paragraph-property revisions on the real corpus.

### Non-Goals

- Comparing the effective formatting resolved through `styles.xml`.
- Tracking edits to `styles.xml` itself.
- Detecting `w:numPr`, `w:jc`, `w:ind`, `w:spacing`, or other paragraph
  properties in this slice.
- Changing run-property detection or `w:rPrChange` behavior.
- Reclassifying inserted, deleted, or moved paragraphs as paragraph-property
  changes.

## Decisions

### Detect at paragraph granularity after content alignment

Build a paragraph-pair inventory from the existing atom/LCS correspondence,
deduplicate by original/revised paragraph identity, and compare the direct
`w:pStyle/@w:val` references only when the paragraph is otherwise aligned.
Represent the result once per paragraph instead of changing every atom's
correlation status.

This keeps counts stable across run fragmentation and gives empty paragraphs
the same semantics as paragraphs containing text.

### Keep the revised style live and snapshot the original properties

The output paragraph's direct properties use the revised `w:pStyle`.
`w:pPrChange` is appended in schema order and contains a bounded original
`w:pPr` snapshot compatible with `CT_PPrBase`. Revision identifiers, author,
and date use the comparison's existing allocation context.

The implementation should reuse or generalize the existing
`addParagraphPropertyChange` machinery rather than create a second serializer.
The generalized helper must accept an explicit original snapshot; snapshotting
the already-revised live paragraph would record the wrong side.

### Report one format change per paragraph

Comparison statistics count one paragraph-style format change for each
affected paragraph, independent of its run count. Revision extraction reports
the emitted `w:pPrChange` through the existing format-change surface without
inventing insertion or deletion counts.

### `ignoreFormatting` accepts the revised style without revision markup

When `ignoreFormatting` is `true`, paragraph-style detection and
`w:pPrChange` emission are disabled. Both reconstruction modes retain the
revised direct `w:pStyle`, so the option does not reintroduce the current
mode-dependent winner. Accept and reject therefore both observe the revised
style for this deliberately ignored difference.

### Compare references, not style semantics

This slice compares absent/present/value changes in direct `w:pStyle`
references. If both paragraphs reference the same style name, changes to that
style's definition are outside scope. Direct formatting and numbering remain
outside scope and must receive separate requirements before implementation.

## Risks / Trade-offs

- Paragraph correspondence assembled from atom matches could be ambiguous
  when repeated empty paragraphs are present. Existing paragraph identity and
  positional context must be used to deduplicate and pair them; tests must
  include consecutive empty paragraphs.
- Reusing a helper designed for inserted paragraphs could capture the live
  properties instead of the original properties. The helper contract and
  projection tests must make the source side explicit.
- A paragraph can contain multiple text atoms. Statistics and revision IDs
  must be paragraph-based to prevent fragmentation-dependent output.
- Choosing revised formatting under `ignoreFormatting` is intentionally
  lossy, but deterministic and consistent with treating the revised document
  as the accepted formatting baseline.

## Validation

- Synthetic DOCX pairs cover style addition, removal, and replacement on empty
  and non-empty paragraphs in both reconstruction modes.
- Accept-all matches the revised style; reject-all matches the original style
  when formatting tracking is enabled.
- Inplace and rebuild projected formatting fidelity is exact for the scoped
  pairs.
- `ignoreFormatting` produces no `w:pPrChange` and retains the revised style
  in both modes.
- A SHA-256-pinned real-corpus measurement asserts that aligned paragraphs
  whose explicit style reference did not change neither enter the
  paragraph-style inventory nor gain `w:pPrChange` attributable to that
  detector.
- The existing #646 unsupported-REF characterization blocks the
  investors-rights document before rebuild atomization. That document remains
  covered through inplace detection, while every currently rebuild-supported
  corpus member runs in both modes; the pre-detection #646 pin does not count
  as paragraph-style evidence.

## Open Questions

None for the scoped `w:pStyle` slice. Additional paragraph properties require
separate semantic decisions and follow-up deltas.
