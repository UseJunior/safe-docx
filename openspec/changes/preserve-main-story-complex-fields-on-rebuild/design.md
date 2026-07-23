## Context

The comparison atomizer recognizes complete complex fields and collapses their
constituent atoms so the differ can treat the visible cached result coherently.
The rebuild reconstructor can expand those atoms, and the pipeline validates
field structure plus accept/reject projections. Expansion, however, is a modeled
reconstruction: it does not promise to retain the exact authored run sequence,
properties, contained range markers, or extension context of an unchanged field.

The opaque SDT work established useful principles—counterpart binding,
paragraph/container ownership, one-owner emission, namespace validation, and
fail-closed ambiguity—but a complex field is an ordered sibling interval rather
than one XML element. Reusing the safety rules does not require pretending the
field is an `w:sdt` node.

## Goals / Non-Goals

- Goals: preserve an unchanged supported main-story complex field as authored
  while edits before or after it remain tracked.
- Goals: make preservation structural and falsifiable through field validation,
  accept/reject projections, and exact/canonical subtree checks.
- Goals: land neutral evidence before implementation and keep evidence scopes
  honest in the capability projection.
- Non-Goals: edit field instructions/results, evaluate fields, support arbitrary
  field types or stories, or broaden the general opaque-passthrough substrate
  beyond what this slice needs.

## Decisions

### A field boundary is an ordered interval descriptor

A `FieldPassthroughSequence` descriptor represents one complete begin →
instruction → separate → cached-result → end interval. It records:

- paragraph and structural-container identity;
- zero-based supported-field occurrence ordinal in that paragraph;
- normalized instruction class and canonical semantic fingerprint;
- cloned ordered source nodes for the complete interval;
- the exact constituent atom count and ownership;
- effective namespace/MCE bindings required by the cloned interval.

Atoms remain the differ's unit. The collapsed field atom carries the descriptor,
and any expanded constituent view points to the same owner. The descriptor is
process-local and is not part of a serialized public API.

### The first slice is deliberately narrow

A candidate qualifies only when all of these are true:

- it is in `word/document.xml`;
- begin, instruction, separate, cached result, and end are complete within one
  paragraph;
- the field is not nested and does not cross an SDT or other unsupported
  structural boundary;
- the normalized instruction is PAGE, NUMPAGES, REF, or PAGEREF;
- original and revised occurrences have the same paragraph/container identity,
  supported-field ordinal, instruction class, and canonical fingerprint.

The fingerprint covers the entire ordered interval, including run properties,
contained bookmark/range markers, attributes, instruction spacing, cached
result, and extension payload. It ignores only lexical namespace declaration
placement when effective namespace-aware meaning is identical.

`REF` is added to the shared field instruction/complete-field fixtures rather
than re-derived in a test. All minimal packages use
`buildDocxFromBodyXml`.

### Unchanged passthrough is separate from field editing

Only an exact correlated pair becomes a passthrough sequence. Legitimate field
insertions, deletions, instruction changes, and cached-result changes continue
through the existing field-aware comparison path and existing validation.

After a pair is selected for passthrough, any correlation loss, changed atom
status, mixed ownership, or incomplete interval fails the rebuild. The
reconstructor never silently falls back from an attempted exact passthrough to
modeled field expansion.

### One owner emits the sequence

At the first atom for a validated sequence, the reconstructor flushes pending
ordinary text and emits the cloned ordered nodes once. Every subsequent atom
owned by that sequence emits nothing. Ordinary atoms before and after it retain
the existing tracked-change path.

Emission must preserve source order relative to ordinary runs and other
supported fields. Multiple sibling fields are supported only when each has a
unique, contiguous, non-crossing interval and counterpart.

### Boundary-crossing markers fail closed

Range markers wholly inside the interval are part of the fingerprint and cloned
payload. A bookmark, comment range, permission range, move range, or other paired
marker with one endpoint inside and one outside the interval makes the field
ineligible for passthrough. If such a field would otherwise be selected, rebuild
fails with a field-passthrough boundary error rather than duplicating or
orphaning the range.

The initial implementation does not prove REF/PAGEREF target semantics. Those
instructions and cached results are preserved exactly; target evaluation remains
the host application's job.

### Existing validators are mandatory postconditions

Every passthrough result must:

- pass the runtime field-structure validator on combined, accepted, and rejected
  documents;
- pass the AI revision validator and emitted schema/MCE gate;
- satisfy normalized accepted text equals revised and rejected text equals
  original;
- contain one structurally equivalent supported field per selected occurrence;
- retain the outside edit on accept and the original outside text on reject.

The existing Lean field invariant remains relevant structural evidence, but the
new exact-passthrough property is a repository-level metamorphic invariant, not
an ECMA-376 claim and not automatically proved by the current Lean model.

### Neutral evidence precedes implementation

The first task is to contribute an implementation-neutral scenario covering an
unchanged complete field plus a same-paragraph outside edit. The SafeDocX
implementation then pins the reviewed upstream commit, runs the adapter, and
refreshes the capability projection.

The neutral scenario demonstrates ordinary user-visible field survival across
implementations. A separate repository test forces `reconstructionMode:
rebuild`; only that test supports the rebuild-specific preservation claim.

## Risks / Trade-offs

- Exact fingerprinting rejects documents whose producer rewrites harmless
  lexical details between original and revised. Failing closed is preferable to
  emitting a subtly changed cross-reference.
- The narrow first slice leaves nested and ancillary-story fields unsupported.
  Keeping story/package ownership out of this PR makes the safety argument
  reviewable.
- Cloning the original interval means a field's cached result is intentionally
  not recalculated after an outside edit. This matches opaque preservation; Word
  may update fields when the document is opened.

## Migration Plan

No document or API migration is required. Supported unchanged fields become more
faithful in rebuild output. Other fields retain the current path. A dedicated
error is returned only when SafeDocX has selected an exact-preservation boundary
and cannot prove that it remains safe to emit.
