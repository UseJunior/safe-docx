# Change: Verify fixed WordprocessingML stories in Lean

## Why

The compiled verifier currently checks only XML selected by TypeScript from `word/document.xml`. Footnotes and endnotes are independent WordprocessingML stories, so neither package-part selection nor field state may remain outside the Lean verifier trust boundary.

## What Changes

- Change the verifier protocol to pass three DOCX package snapshots and let the compiled Lean process extract the fixed story parts.
- Check the required main story and optional footnote/endnote stories as independent named triples, modeling a missing optional side as empty when any side supplies the part.
- Prove that a passing collection report implies every supplied story report passes, without residual comparison axioms.
- Resolve XML namespace prefixes inside Lean, reject malformed roots, and project typed reserved note separator entries explicitly before note text comparison.
- Bound package and extracted-part sizes and preserve the public v1 certificate shape through additive fixed-story evidence.
- Return per-story certificates and document the exact fixed-story scope and exclusions.

## Impact

- Affected specs: `docx-comparison`
- Affected code: Lean checker/executable, TypeScript launcher and certificate types, comparison integration tests, verification coverage ledger and docs
- The executable relies on an available `unzip` command for bounded DOCX package extraction; missing, corrupt, or oversized extraction support fails closed as `not_run`.
