# Change: Preserve unchanged main-story complex fields on rebuild

## Why

Forced comparison rebuild can reconstruct visible field results while losing the
authored complex-field sequence and run-level payload around it. That is unsafe
for legal documents: PAGE/NUMPAGES pagination and REF/PAGEREF cross-references
may still look plausible in extracted text even after their field machinery has
been flattened or normalized beyond recognition.

SafeDocX already validates complex-field structure, carries collapsed field atoms,
and formally checks field preservation invariants. The remaining gap is exact,
bounded passthrough of an unchanged field while an edit elsewhere in the same
paragraph remains active.

## What Changes

- Add a neutral docx-platform-tests scenario for an unchanged complex field with
  a same-paragraph outside edit before implementing the repository-specific path.
- Preserve complete, unchanged, non-nested PAGE, NUMPAGES, REF, and PAGEREF
  complex fields in the main document story during forced rebuild.
- Capture the ordered field interval from `w:fldChar` begin through its matching
  end, including instruction runs, separator, cached result, run properties,
  bookmarks/range markers wholly contained in the interval, and namespace/MCE
  context required by the captured nodes.
- Correlate original and revised field occurrences by paragraph/container
  ownership, field ordinal, instruction class, and canonical semantic
  fingerprint; emit the validated original sequence exactly once while applying
  edits outside it.
- Fail closed when a field selected for passthrough has ambiguous ownership,
  non-contiguous atoms, unsafe boundary-crossing markers, correlation loss, or
  mutation. Existing field insertion, deletion, and modification behavior
  remains on its current validated path and is not relabeled as passthrough.
- Verify field structure and accept/reject projections for every preserved
  output, then measure preservation on real field-bearing repository documents.
- Pin the reviewed neutral-suite commit and refresh the capability projection
  without presenting ordinary neutral evidence as proof of forced rebuild.

## Impact

- Affected specs: `docx-comparison`, `cross-implementation-conformance`,
  `spec-compliance`
- Affected code: field atomization/correlation, rebuild reconstruction, shared
  OOXML fixtures, focused/real-document tests, neutral-suite pin and capability
  projection
- Ref: #582

## Out of scope

- Field insertions, deletions, instruction rewrites, cached-result changes, or
  editing inside a preserved field boundary.
- Nested fields, fields spanning paragraphs, `w:fldSimple`, form fields, TOC
  fields, and fields in headers, footers, footnotes, endnotes, comments, text
  boxes, or content controls.
- Recalculating cached field results or proving that REF/PAGEREF bookmark targets
  are semantically correct; Word or another host remains the field evaluator.
- Preserving `sectPr`, arbitrary rsids outside captured nodes, row/cell/nested
  content controls, ancillary story reconstruction, or arbitrary package parts.
