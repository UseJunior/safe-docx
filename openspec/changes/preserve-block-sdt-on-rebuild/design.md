## Context

The inline-SDT pilot associates one opaque boundary with atoms in one paragraph
and emits it from the paragraph run stream. A direct body-level block SDT owns
multiple descendant paragraph slots and must instead be emitted by the original
body scaffold. Reconstructing any owned paragraph destroys exact subtree
preservation; preserving the original wrapper after replacing descendants is
also insufficient because it loses controlled paragraph attributes and complex
payload such as DrawingML.

## Goals / Non-Goals

- Goals: preserve an unchanged direct `w:body/w:sdt` subtree and its effective
  namespace/MCE semantics while unrelated body paragraphs rebuild normally.
- Goals: bind the control to one contiguous source-order paragraph-slot interval,
  validate every controlled paragraph's relative ownership, and consume that
  interval atomically in the scaffold.
- Goals: pair multiple or identical controls deterministically from local body
  placement and ownership, with precomputed/memoized group identity and
  deterministic complexity evidence.
- Goals: preserve row- and cell-scoped control wrappers through their existing
  table scaffold while allowing ordinary tracked paragraph reconstruction
  inside `w:sdtContent`.
- Non-Goals: nested controls; controls outside `document.xml`;
  footer or ancillary reconstruction; tables inside a direct-body opaque
  control; rsids outside the preserved subtree; fields; `sectPr`; arbitrary
  package parts.

## Decisions

### Placement is explicit

`OpaquePassthroughNode` records `placementKind` as `inline-run` or
`body-block`, plus `row-block` and `cell-block`. Inline descriptors retain one paragraph owner and paragraph-run
emission. Body-block descriptors record their direct body-child ordinal and a
closed, contiguous interval of global paragraph slots. A block descriptor is
attached to every atom in every owned paragraph, but its subtree is emitted only
by the body scaffold. Row/cell descriptors record their direct parent-child
ordinal and a wrapper fingerprint that replaces controlled paragraphs with
structural markers, so paragraph content can change without laundering wrapper
or table/cell scaffold changes.

### Correlation is local and fail closed

Original and revised occurrences pair by placement, direct body-child ordinal,
slot interval, relative paragraph ownership, namespace-aware semantic
fingerprint, and boundary QName. Document-wide SDT ordinal alone is never used
to make identical controls appear correlated. Each owned paragraph must remain
equal at the opaque identity level and in the same relative slot. Mutation,
insertion, deletion, reordering, movement, non-contiguous ownership, missing
atoms, or a non-equal owned atom rejects before paragraph serialization.

### The scaffold owns block emission

The reconstructor preflights block ownership before building paragraph XML.
When its slot cursor reaches the first owned slot, it leaves the validated
original block subtree in place and advances over the full owned interval.
No owned paragraph is reconstructed or replaced. Inserted content cannot be
placed into the interval. Paragraphs outside the interval retain the existing
tracked-change path.

### Namespace and relationship semantics reuse the opaque substrate

Fingerprinting, effective namespace/MCE validation, and source subtree capture
are shared between placements. Block counterpart identity additionally resolves
every relationship-namespace attribute through the owning part. It includes the
relationship Id, type, target mode, normalized target, and internal target part
path and byte hash. Referenced XML parts recursively contribute their referenced
relationship closure. Relationship tables, part hashes, and closure nodes are
memoized per package. Recursive closure identities are cached only after they
complete, and root traversals are serialized so independent roots cannot await
each other's unresolved cycle. Blocks without relationship attributes avoid all
archive reads. Internal targets accept only package-root or package-relative URI
paths after safe decoding; authority references, URI schemes, malformed escapes,
backslashes, control characters, and package-root escapes fail closed before
normalization. Dangling, cyclic, and unsupported relationship-bearing targets
also fail closed before correlation.

### Claims remain bounded

Block structure is cited to ECMA-376 Part 1 §§17.5.2.29, 17.5.2.34, and
17.5.2.38; cell-level structure inside a row is cited to §§17.5.2.32 and
17.5.2.33. Exact opaque preservation and package-part stability are SafeDocX
metamorphic invariants, not requirements imposed by ECMA-376.

## Risks / Trade-offs

- An otherwise safe edit inside a direct-body opaque control is rejected. This
  avoids silently preserving stale controlled content or flattening unsupported
  structure.
- Direct body controls containing tables remain rejected because their opaque
  paragraph-slot ownership cannot represent nested table placement safely.
- Row/cell controls allow paragraph edits but reject wrapper, cell-property, or
  table-shape changes that the paragraph reconstructor cannot safely represent.
- Footer SDTs remain outside reconstruction support; package-clone identity may
  be observed only as no-regression evidence.

## Migration Plan

No API migration is required. Existing inline and direct-body controls keep
their current behavior. Row/cell controls use the existing table scaffold only
when their wrapper and structural identity correlate.
