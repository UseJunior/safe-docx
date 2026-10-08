# Change: Carry header/footer references forward when a revision removes a section boundary

## Why

Word 16 records a tracked section-break insertion on an empty paragraph whose
mark is a tracked insertion and whose `w:sectPr` holds the header/footer
references. The following section gets no references of its own, so it is
linked to previous. Rejecting that inserted mark, or accepting a deleted
paragraph mark that owns a `w:sectPr`, merges the boundary away. docx-core
`acceptChanges`/`rejectChanges` and docx-compare
`acceptAllChanges`/`rejectAllChanges` dropped the references with it, so the
surviving section showed no header or footer (#1144, cases S1e and S3b).
`w:sectPrChange` holds `CT_SectPrBase`, which cannot record reference changes,
so the rule has to live in the appliers.

## What Changes

- New docx-core helpers in `section_boundary_references.ts`:
  `followingSectionProperties`, `carryForwardHeaderFooterRefs` and
  `carryHeaderFooterRefsFromRemovedBoundary`.
- When an applier removes a paragraph-owned section boundary, the surviving
  section is the next section in document order (the next paragraph-owned
  `w:sectPr`, else the body-level one). If the survivor has no
  `w:headerReference`/`w:footerReference`, it receives copies of all the
  removed section's references, placed first as CT_SectPr requires. If the
  survivor has any reference of its own, nothing is copied. `w:titlePg` and
  page setup stay the survivor's.
- This is Word's observed Accept All / Reject All behaviour (Word 16 for Mac),
  not a per-type merge: a survivor with only a default header does not receive
  the removed section's first-page, even-page or footer references.
- Removal paths covered: the paragraph-mark merge and the dropped empty
  boundary paragraph in all four appliers, and docx-core reject of a
  paragraph-owned `w:sectPrChange` without a snapshot, which removes the
  `w:sectPr`. Accepting `acceptedSectionBreakRemovalContainer` removes a
  `w:sectPr` whose only child is the change record, which holds no
  references, so it needs no transfer.

- docx-compare's `acceptAllChanges`/`rejectAllChanges` take an optional
  `{ carryHeaderFooterReferences }` (default `true`). The comparison
  pipeline's header/footer story checks (`rejectedSelectedAncillaryStoryPaths`,
  `deletedAncillaryStoryOutputPaths`, `assertAncillaryTextBoxStoryProjection`)
  pass `false`. They compare explicit bindings and ask which stories surviving
  references still select, so their decisions are unchanged. With the carry, a
  lifecycle story whose tracked content projects to empty would also count
  as selected. The #754 test now expects Accept All to leave the removed
  section's footer bound to the linked final section, with no text, as Word
  does.
- Not in scope: teaching those checks Word's carry (effective bindings, empty
  stories treated as absent). Until then, a comparison where an added or
  removed section's own story is inherited by a following section that, on
  the other side, displays a different story can still round-trip
  differently under Word's Accept/Reject All.

## Impact

- Affected specs: `docx-primitives`
- Affected code: `packages/docx-core/src/primitives/section_boundary_references.ts`,
  `accept_changes.ts`, `reject_changes.ts`,
  `packages/docx-compare/src/tagged/trackChangesAcceptorAst.ts`
