## Context

`collapseFieldSequences` intentionally reduces a same-paragraph complex field to
one visible-result atom so LCS can match field results with ordinary text. The
collapsed atom retains its constituent leaves, but rebuild reconstruction emits
those leaves inside one new `w:r`. A valid multi-run field therefore keeps its
text and markers while losing its authored XML topology.

The inline/block SDT work already provides a fail-closed opaque passthrough
substrate: atoms carry a process-local owner descriptor, counterpart binding
compares semantic fingerprints and placement, merged correlation must remain
equal and contiguous, and reconstruction emits one validated owner.

## Goals / Non-Goals

- Goals: preserve the ordered direct paragraph-child range from the child
  containing the outer `w:fldChar` begin through the child containing its
  matching end.
- Goals: preserve run boundaries/properties, field markers, fragmented
  instruction text, cached result runs, supported non-revision wrappers,
  attributes, namespaces, MCE declarations, and extension payload.
- Goals: support PAGE, NUMPAGES, REF, and PAGEREF instruction codes with
  conservative case, whitespace, argument, and switch parsing.
- Goals: fail before reconstruction when an unchanged opaque range cannot be
  established and correlated exactly.
- Non-Goals: ancillary stories, field evaluation, cached-result correctness,
  changed fields, nested fields, fields spanning paragraphs, or fields owned by
  tracked paragraph revisions.
- Non-Goals: changes to inplace comparison or its field-fragmentation behavior.
- Non-Goals: extending the Lean XML verifier. Rebuild evidence remains
  `not_applicable`; the current Lean token model does not express run topology,
  wrappers, instruction semantics, or extension payload.

## Decisions

### Ordered inline ranges extend the existing opaque owner

`OpaquePassthroughNode` gains an ordered-inline-range placement and ordered
source/emission element arrays. Existing SDT owners continue to contain one
element. A field owner contains every direct paragraph child in its bounded
range, with effective namespace and MCE declarations materialized on each
cloned child. Reconstruction serializes the array in order exactly once.

This keeps counterpart, equal-correlation, contiguity, source-order, and
one-owner checks shared rather than introducing field-specific reconstruction.
Direct-child start/end positions locate the source payload but are not
counterpart identity. Field ranges pair by stable paragraph/container identity
and their sequence ordinal among captured fields in that paragraph, so an
ordinary sibling insertion or deletion before a field may shift source
positions without changing field identity.

### Capture operates on raw atoms before collapse

The capture pass walks raw field atoms using a begin/separate/end state machine,
maps each outer field endpoint to its direct paragraph child, and validates that
the complete direct-child range contains no atoms outside that field. It then
classifies the concatenated `w:instrText` payload.

Only one non-nested field may own a supported range. Identifiable supported
fields that are malformed, nested, overlapping, spanning, shared-endpoint, or
unsupported-placement fail closed. Malformed unsupported instructions retain
the existing post-rebuild safety-diagnostics behavior rather than becoming new
opaque-preflight errors. A field wholly inside an already captured unchanged
inline SDT remains owned by that SDT. Partial overlap with another opaque owner
fails. Non-revision wrappers such as `w:hyperlink` are retained; field ranges
owned by `w:ins`, `w:del`, `w:moveFrom`, or `w:moveTo` are excluded.

### Field classification is semantic and conservative

Instruction text is concatenated in document order, trimmed, and tokenized with
quoted arguments and backslash switches retained. The leading keyword is
case-insensitive. PAGE and NUMPAGES accept only their defined switch-shaped
tails. REF and PAGEREF require one bookmark argument and accept switch-shaped
tails. REF `\d` additionally requires and consumes one separator argument.
Unknown keywords, malformed quoting, missing arguments, nested field payload,
or non-instruction content before `separate` are unsupported.

Classification controls eligibility only; the exact authored instruction XML is
preserved and fingerprinted.

### Exact preservation is a metamorphic invariant

ECMA-376 edition 5 Part 1 §§17.16.18, 17.16.5.42, 17.16.5.44,
17.16.5.45, and 17.16.5.51 identify complex-field structure and the supported
instructions. They do not require SafeDocX to preserve lexical topology through
comparison. Tests therefore cite the normative field clauses while describing
ordered topology preservation as a stronger SafeDocX metamorphic invariant.

## Risks / Trade-offs

- Conservative ownership rejects documents that could potentially be rebuilt
  safely. This is preferable to silently flattening an unmodeled field shape.
- Materializing inherited namespace declarations may change lexical placement
  while preserving namespace semantics. Assertions compare ordered DOM topology,
  QNames, attributes, and text rather than package bytes.
- Pairing requires stable paragraph/container ownership and field-range
  sequence. Unrelated sibling edits may shift direct-child positions.
  Cross-paragraph movement and reordering of distinct fields are intentionally
  unsupported.

## Migration Plan

No public API migration is required. Existing inplace behavior is unchanged.
Forced rebuild gains preservation for unchanged supported fields and explicit
failure for identifiable supported field topology that would otherwise be
lossy. Unsupported field instructions retain existing rebuild diagnostics.
