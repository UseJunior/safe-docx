## Context

`w:sectPrChange` stores the prior section-property state. In the observed removal
shape, the live paragraph-owned `w:sectPr` has no current property children; its
only element child is the change snapshot. Removing only the snapshot converts
that revision record into an empty but semantically active section break.

## Goals / Non-Goals

- Goals: make accept-all reflect removal of the paragraph-level section break;
  keep reject-all restoration unchanged; preserve exact fidelity enforcement.
- Non-Goals: change section alignment, lower safety thresholds, special-case any
  publisher document, or reinterpret nonempty/live section properties.

## Decisions

- Record removable section containers before deleting property-change records.
  A container qualifies only when it is `w:pPr > w:sectPr`, has a direct
  `w:sectPrChange`, has no other direct element children, and the change
  snapshot records at least one prior section property.
- Never remove `w:body > w:sectPr`; it is the final section-properties container,
  not a paragraph-level section break.
- Keep the fidelity oracle and its exact threshold unchanged. The regression
  exercises the real accept/reject projections over independently invented XML.

## Risks / Trade-offs

- Malformed empty paragraph-owned section properties without a change snapshot
  remain untouched and visible to safety checks.
- A paragraph section with any live property child remains a live section break,
  even if it also carries a historical snapshot.
- An empty live `w:sectPr` over an empty snapshot is kept: the serializer emits
  that shape for an added break with default properties, which accept-all must
  keep. A removed break whose original carried no `CT_SectPrBase` property has
  the same shape, so accept-all still leaves that default-property break in
  place. This is a known limitation: the formatting-fidelity gate compares
  section properties, not section counts, and scores this case 1.0, so it is
  not a safeguard here.
- A break the revised document kept as a completely empty `w:sectPr` while the
  original carried properties is indistinguishable from a removal in the
  tracked XML and is removed on accept-all. The fidelity gate also scores this
  case 1.0. Real section breaks carry page setup, so this shape is not
  expected from Word-authored input; disambiguating it would need a serializer
  change and is out of scope here.
