# Change: Keep the live section when resolving a `w:sectPrChange` with no snapshot

## Why

`CT_SectPrChange` may omit its `w:sectPr` snapshot (ECMA-376 Part 1
§ 17.13.5.32; `wml.xsd` CT_SectPrChange, `minOccurs="0"`). docx-core
`rejectChanges` treated an absent snapshot as "the prior properties were
empty" and removed the whole live `w:sectPr`. For a paragraph-owned section
that deleted the section break, its page setup and its header/footer
bindings (#1144's carry then moved the references to the next section).
docx-compare's `rejectAllChanges` already kept the live section, so the two
reject paths disagreed (#987).

Word 16 for Mac Reject All and Accept All were run on body-level and
paragraph-level sections, with and without header/footer references,
`w:titlePg` and landscape page setup. In every case Word drops the record
and keeps the live `w:sectPr` unchanged: the section break, page size and
orientation, margins, `w:titlePg` and all six bindings. A live paragraph
`w:sectPr` that holds only a snapshot-less `w:sectPrChange` is kept as a
break with default page setup. A break goes away only when its paragraph mark
is a revision the operation removes (inserted mark rejected, deleted mark
accepted); its references then carry forward as #1144 specifies, whether or
not it also has a snapshot-less `w:sectPrChange`.

## What Changes

- docx-core `rejectChanges`: a `w:sectPrChange` with no `w:sectPr` child is
  resolved by removing only the record. The live `w:sectPr` is kept and
  nothing is carried to the following section.
- No change to docx-compare `rejectAllChanges`, `acceptAllChanges` or
  docx-core `acceptChanges`: they already match Word for this shape.
- The #1188 test "docx-core reject of a snapshot-less paragraph section
  change" now expects Word's result (section kept, nothing carried) instead
  of the removal it used to pin.

## Not in scope

- Snapshot-present semantics. Word also treats an empty snapshot
  (`<w:sectPrChange><w:sectPr/></w:sectPrChange>`) as "keep the live
  properties", and treats a partial snapshot as an overlay (properties and
  attributes the snapshot omits keep their live values). All four appliers
  restore a present snapshot as a full replacement. That is a separate
  decision.

## Impact

- Affected specs: `docx-primitives`
- Affected code: `packages/docx-core/src/primitives/reject_changes.ts`
