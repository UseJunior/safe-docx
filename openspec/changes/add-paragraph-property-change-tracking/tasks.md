## 1. Specification and evidence

- [x] 1.1 Add failing traceability scenarios for `w:pStyle` addition,
  removal, and replacement on aligned empty and non-empty paragraphs.
- [x] 1.2 Add both-mode accept/reject projection assertions and
  paragraph-level statistics/revision-extraction assertions.
- [x] 1.3 Add `ignoreFormatting` scenarios proving both modes retain the
  revised style without `w:pPrChange`.
- [x] 1.4 Add a SHA-256-pinned real-corpus no-phantom measurement.

## 2. Paragraph-style detection

- [x] 2.1 Build a deduplicated inventory of aligned paragraph pairs from the
  existing atom correspondence.
- [x] 2.2 Compare direct `w:pStyle/@w:val` references once per aligned
  paragraph and carry explicit original/revised paragraph properties.
- [x] 2.3 Exclude inserted, deleted, moved, and text-divergent paragraph pairs
  from this property-only classification.
- [x] 2.4 Count each detected paragraph-style change once, independent of run
  fragmentation.

## 3. Reconstruction and revision surfaces

- [x] 3.1 Generalize the existing paragraph-property revision helper to accept
  the original `w:pPr` snapshot while keeping revised properties live.
- [x] 3.2 Apply the same paragraph-style change inventory in inplace and
  rebuild reconstruction with schema-ordered `w:pPrChange`.
- [x] 3.3 Surface emitted paragraph-property revisions through existing
  revision extraction without changing insertion or deletion counts.
- [x] 3.4 Make `ignoreFormatting` consistently retain revised `w:pStyle` in
  both reconstruction modes without revision markup.

## 4. Conformance and validation

- [x] 4.1 Add ECMA-376 5th edition, Part 1 § 17.13.5.29 source citations and
  structured test conformance labels.
- [x] 4.2 Run `openspec validate add-paragraph-property-change-tracking
  --strict`.
- [x] 4.3 Run the repository pre-submit suite and the required real-corpus
  comparison gate.
