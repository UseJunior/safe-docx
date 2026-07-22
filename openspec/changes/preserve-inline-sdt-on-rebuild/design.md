## Context

The atomizer recursively descends through an inline `w:sdt`, but the rebuild
reconstructor emits only leaf content and selected hand-modeled wrappers. The
original paragraph slot is replaced, so the scaffold cannot preserve an inline
control in the edited paragraph. `restoreUntouchedBlocks` is irrelevant to
forced comparison rebuild and must not be part of the acceptance evidence.

The repository includes real ILPA documents with block-level cover-page SDTs,
but no real inline-SDT fixture. Focused inline structure tests therefore use the
shared minimal-DOCX fixture helper; the real documents provide only a separately
labeled no-regression count.

## Goals / Non-Goals

- Goals: preserve an unchanged inline SDT's ordered semantic subtree, controlled
  text, known `w:sdtPr` children, ignorable foreign extension payload, and
  effective namespace/MCE declarations during forced rebuild.
- Goals: preserve intentional edits outside that boundary and support controls
  among paragraph runs, split runs, multiple sibling controls, root/local
  declarations, and prefix aliases.
- Goals: provide a reusable opaque-node descriptor and emitter contract that can
  later support other bounded OOXML nodes.
- Non-Goals: editable SDT contents; block/cell/row SDTs; nested opaque boundaries;
  rsids, fields, `sectPr`, ancillary parts, arbitrary package parts, or arbitrary
  XML preservation.

## Decisions

### Opaque descriptor belongs to atoms

Each atom under a supported boundary carries an `OpaquePassthroughNode`
descriptor containing a stable occurrence key, boundary QName/namespace,
canonical semantic fingerprint, cloned boundary element, effective namespace
bindings needed by the subtree, and its ordinal ownership within the paragraph.
The descriptor is generic; only the importer policy names `w:sdt` as the pilot
boundary. Unknown extension element and attribute names are never enumerated.

### Original and revised boundaries must match exactly

Passthrough is allowed only when one original occurrence and one revised
occurrence have the same paragraph-relative ordinal and canonical semantic
fingerprint. Every atom owned by the boundary must remain equal and contiguous
after comparison. Missing counterparts, changed controlled text/properties,
crossed ordering, mixed ownership, nested supported boundaries, or a change
status inside the boundary raise a dedicated reconstruction error. This pilot
does not infer edits inside opaque XML.

Each descriptor also records its source-order paragraph ordinal and structural
container path. That identity is a coarse paragraph anchor when ordinary text
around a control is wholly replaced. A changed paragraph ordinal or container,
including paragraph movement, remains outside the pilot and fails before LCS
reconstruction. After correlation, every emitted opaque atom must still be an
equal revised-side atom in one reconstructed paragraph; otherwise preflight
fails before whole-paragraph insertion/deletion branches can flatten it.

### One owner emits; all other owned atoms are suppressed

The first merged atom for a validated occurrence emits the cloned boundary.
Subsequent atoms with that occurrence key emit nothing. Ordinary atoms before
and after it continue through the existing run/revision generator. This gives a
single deterministic order and prevents duplicate controls when text is split
across multiple runs or word atoms.

### Namespace ownership is explicit

Capture resolves every prefix used by the boundary subtree (including prefixes
named by `mc:Ignorable`) against declarations effective at the source node.
Descendant validation derives a fresh effective scope at each element, so a
valid local declaration or legal prefix shadow is retained while unbound or
mismatched usage is rejected.
Emission materializes required declarations on the cloned boundary when they
are inherited from an ancestor. A prefix with no binding, conflicting bindings
for one prefix, an unbound `mc:Ignorable` token, or a collision with the emitter's
fixed wrapper bindings fails closed. Prefix aliases are preserved as authored;
the substrate does not rewrite QName-valued extension content.

### Claims are bounded

Inline SDT structure is cited to ECMA-376 Part 1 §§17.5.2.31, 17.5.2.36, and
17.5.2.38. Preservation of unknown ignorable extension payload is a metamorphic
SafeDocX invariant, not an ECMA-376 requirement. No claim extends beyond the
captured inline-SDT node boundary.

## Risks / Trade-offs

- The pilot rejects safe-looking SDT mutations instead of rebuilding them. This
  is deliberate: preserving stale content or flattening a changed control would
  be silent corruption.
- Materializing inherited namespace declarations can change lexical XML while
  retaining namespace/MCE semantics. Tests compare namespace-aware structure,
  ordered children, attributes, and payload rather than byte identity.
- Carrying cloned DOM nodes is process-local and not JSON-serializable. The
  comparison atom model is already DOM-backed; no public serialized API changes.

## Migration Plan

No migration is required. Existing non-SDT rebuilds retain their current path.
Inline SDTs that previously flattened are preserved when unchanged and rejected
when the opaque contract cannot be established.
