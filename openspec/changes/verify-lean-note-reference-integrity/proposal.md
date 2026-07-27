# Change: Verify relationship-selected note reference integrity in Lean

## Why

The compiled Lean verifier currently reads footnotes and endnotes only from
conventional fixed paths and checks their text and field-token projections. It
does not prove that a package's note references resolve to unique user-note
definitions or that the checked note parts are the parts selected by the main
document's relationships.

## What Changes

- Move the internal compiled-checker protocol from v4 to v5 while retaining the
  same three immutable DOCX path inputs and no TypeScript-produced manifest.
- Make Lean select at most one Transitional internal Footnotes Part and one
  Transitional internal Endnotes Part per package from the relationships part
  derived specifically from the fixed conventional Main Document Part
  `word/document.xml`. Do not add `_rels/.rels` or general main-part discovery.
  Normalize each target with the existing bounded package policy, require the
  corresponding root, and align triples by semantic kind across safe paths.
- Collect typed decimal `w:id` values from direct user-note definitions and
  `w:footnoteReference`/`w:endnoteReference` elements in every successfully
  checked content story. Classify note definitions by `w:type`, rather than by
  numeric-ID convention.
- Treat main and selected direct headers/footers as the complete valid
  reference-source partition. Scan note-definition stories for definitions and
  reject every nested footnote/endnote reference, including self and cross-kind
  cycles, as structured nonconformance rather than following it as closure.
- Define complete sides by independent load/decode/parse/full-scan evidence for
  every expected present source, a 1,000,000-event side-wide bound, and explicit
  valid-absence semantics for optional note slots. Tag incomplete sides as an
  intrinsic story failure, local semantic crossing, or a later side skipped
  after the globally first crossing. Bind global selected stories per side to
  an independent canonical derivation from that side's package view and derive
  admission events from those same selections.
- Check each package independently: every valid-source reference must resolve
  to exactly one user-note definition of the same kind; canonical duplicate
  user-definition IDs fail; unreferenced user-note definitions remain valid.
- Add six exact axiom-free selector, complete-partition, parsed-evidence,
  package-integrity, incomplete-side-zero-evidence, and aggregate-pass theorem
  targets over independently defined relationship-record,
  load/decode/parse/full-scan, partition, aggregate, and serialized-response
  predicates so omitted, partial, or output-derived work cannot satisfy the
  certificate vacuously.
- Fully pin protocol v5 to three source partitions, two semantic note-story
  slots, six side-kind inventories, deterministic coalesced issues, exact
  ordinal spaces and required source identities for v5 note issues, unchanged
  v4 selection-issue field shape/order/coalescing with cardinality replaced by
  the shared v5 cap, total cross-array crossing precedence,
  terminal collapse, semantic-limit equations, resource admission order, a
  realizable 2,619,776-byte ordinary maximum, and a conservative structurally
  charged 2,621,440-byte JSON envelope plus the required one-byte newline,
  yielding the 2,621,441-byte legal stdout envelope.
- Keep the public document-integrity certificate at protocol v1. Add honest
  optional note-reference scope, selected-path, inventory, and failure evidence
  without requiring Lean at downstream runtime beyond the shipped compiled
  checker.
- Add synthetic adversarial tests and a real NVCA source-derived fixture that
  adds a valid endnote relationship, reference, and definition so both note
  kinds are non-vacuous before mutation.
- Update the Lean coverage registry and ECMA-376 traceability for the exact
  supported clauses and vendored Transitional schema declarations.

## Impact

- Affected specs: `docx-comparison`, `spec-compliance`
- Affected code after approval: Lean package selector and checker, internal
  protocol and TypeScript decoder, public additive certificate types, focused
  compiled tests, NVCA integration tests, axiom audit, CI paths, coverage
  registry, ECMA registry, and generated conformance documentation
- Compatibility: internal protocol v4 fixtures migrate explicitly to v5; the
  public certificate remains v1 and legacy certificate decoding remains
  supported
- Scope: Transitional footnotes/endnotes owned by the fixed conventional
  `word/document.xml` Main Document Part, in inplace comparison only
- Explicit exclusions: comments and modern comments; display numbering,
  custom-mark rendering, pagination, and layout; content-type and full OPC
  validation, `_rels/.rels` main-part discovery; Strict namespaces; rebuild
  certification; recursive note-reference closure; and any claim that an
  unreferenced note definition is invalid
- Refs: #640, #631, #547, #595
