# Change: Verify ancillary field stories after package assembly

## Why

Comparison currently validates main-document field structure and pre-merge note
sidecars before it chooses and assembles the output package. That does not prove
that valid section-bound header/footer parts or the final, merged note entries
are independently well formed, and it provides no source-first preservation
evidence for unchanged fields in those ancillary stories.

## What Changes

- Reuse the section-property audit contract to select only valid
  `w:headerReference` and `w:footerReference` bindings through typed final
  `word/_rels/document.xml.rels` relationships and the shared robust OPC
  target normalizer; reject indirect binding placement, invalid target modes,
  and unsafe targets, and never discover parts by filename glob.
- Add a strict runtime ancillary field-story predicate, separate from the
  Lean-pinned `validateFieldStructure`, and apply it independently to every
  selected header/footer and every final footnote/endnote entry.
- Canonicalize direct footnote/endnote entry IDs as `xsd:integer` values and
  reject invalid lexical IDs or numeric-equivalent duplicates before
  provenance or evidence mapping so structural locators remain unambiguous.
- Inventory eligible source PAGE/NUMPAGES ranges in selected headers/footers
  and REF/PAGEREF ranges in note definitions, retain post-collision assembly
  provenance, and require the final inventory to match exactly by structural
  locator and PR #617 canonical range.
- Reject a failing inplace package candidate and attempt one rebuilt assembly.
  Throw a typed ancillary-story safety error if direct/forced rebuild or the
  terminal rebuilt fallback fails; never return a warning-only successful
  comparison for relationship, strict-field, or preservation failures.
- Add optional successful `CompareResult.ancillaryFieldEvidence`, an ancillary
  fallback reason, and rejected-candidate ancillary fallback diagnostics without
  changing existing result fields.
- Exercise forced rebuild, true inplace, ancillary-triggered inplace fallback,
  terminal failure, ID collision/renumbering, and a minimally edited pair
  derived from the checked-in NVCA COI source document. Run that same real
  source-derived pair through true inplace and forced rebuild and require
  nonzero footer PAGE and footnote REF evidence in both.
- Keep ancillary revision synthesis, ancillary text comparison, field
  evaluation, pagination, bookmark resolution, and complete note
  reference/relationship integrity outside this change.
- Keep the compiled Lean checker at protocol v3 with its existing inplace-only
  fixed scope of main, footnotes, and endnotes. Relationship-addressed
  header/footer Lean stories remain a separate next slice.

## Impact

- Affected specs: `docx-comparison`, `spec-compliance`
- Affected code: section binding audit extraction, atomizer package assembly
  and typed safety errors, strict runtime field-story validation, auxiliary
  merge provenance, source/final field inventory, synthetic and NVCA tests,
  ECMA-376 registry evidence
- Ref: #582
