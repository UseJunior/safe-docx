# Change: Track paragraph style changes during comparison

## Why

The comparison engine detects run-property changes but silently drops a change
confined to `w:pStyle`. Inplace reconstruction keeps the revised style while
rebuild keeps the original style, so identical inputs can produce
mode-dependent output with no revision explaining the difference.

Issue #678 removed paragraph properties from empty-paragraph identity so empty
paragraphs can remain aligned. The comparison layer can now address the actual
capability gap consistently for empty and non-empty paragraphs.

## What Changes

- Detect an explicit `w:pStyle` reference change on an otherwise aligned
  paragraph, including empty paragraphs.
- Emit one native `w:pPrChange` record per changed paragraph, with the revised
  style active and the original paragraph properties stored in the snapshot.
- Make inplace and rebuild comparison agree on accept/reject projections and
  paragraph-level format-change reporting.
- Define `ignoreFormatting: true` to suppress paragraph-style revision markup
  while retaining the revised style consistently in both reconstruction modes.
- Measure the SHA-256-pinned real corpus to ensure unchanged paragraph styles
  do not acquire phantom `w:pPrChange` markup.
- Explicitly defer direct paragraph properties (`w:jc`, `w:ind`, `w:spacing`),
  numbering (`w:numPr`), and semantic changes within `styles.xml`.

## Impact

- Affected specs: `docx-comparison`
- Affected code: paragraph alignment and format detection, inplace and rebuild
  reconstruction, comparison statistics/revision extraction, and real-corpus
  comparison evidence
- Conformance target: ECMA-376 5th edition, Part 1 § 17.13.5.29
- Related issues: #679, #678
