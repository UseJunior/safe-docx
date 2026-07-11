# Change: Verify fixed WordprocessingML stories in Lean

## Why

The compiled verifier currently checks only XML selected by TypeScript from `word/document.xml`. Footnotes and endnotes are independent WordprocessingML stories, so neither package-part selection nor field state may remain outside the Lean verifier trust boundary.

## What Changes

- Change the verifier protocol to pass three DOCX package snapshots and let the compiled Lean process extract the fixed story parts.
- Check the required main story and symmetrically present optional footnote and endnote stories as independent named triples.
- Prove that a passing collection report implies every supplied story report passes, without residual comparison axioms.
- Project reserved note separator entries explicitly before note text comparison.
- Return per-story certificates and document the exact fixed-story scope and exclusions.

## Impact

- Affected specs: `docx-comparison`
- Affected code: Lean checker/executable, TypeScript launcher and certificate types, comparison integration tests, verification coverage ledger and docs
- The executable relies on an available `unzip` command for DOCX package extraction; missing extraction support fails closed as `not_run`.

