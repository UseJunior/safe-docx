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
  `w:sectPrChange`, and has no other direct element children.
- Never remove `w:body > w:sectPr`; it is the final section-properties container,
  not a paragraph-level section break.
- Keep the fidelity oracle and its exact threshold unchanged. The regression
  exercises the real accept/reject projections over independently invented XML.

## Risks / Trade-offs

- Malformed empty paragraph-owned section properties without a change snapshot
  remain untouched and visible to safety checks.
- A paragraph section with any live property child remains a live section break,
  even if it also carries a historical snapshot.

