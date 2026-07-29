# Change: Verify legacy comment range topology in Lean

## Why

The compiled protocol-v6 checker proves relationship-selected legacy comment
definition/reference integrity, but intentionally ignores
`w:commentRangeStart` and `w:commentRangeEnd`. A package can therefore pass with
orphaned, reversed, duplicated, mismatched, or cross-story range markers.

ECMA-376 does not require range markers to be paired: an unmatched start or end
can be a point anchor. Safe-DOCX nevertheless needs a narrower, deterministic
verification profile for certified comparisons. This change must describe
orphan-endpoint rejection honestly as a stronger Safe-DOCX profile rule and
conformance gap, not as an ECMA pairing requirement.

## What Changes

- Add a separate change for legacy comment range topology without reopening or
  modifying `verify-lean-comment-reference-integrity`.
- Migrate the private compiled-checker request/response from protocol v6 to v7
  because the exact grammar, inventory evidence, issue set, projection, and
  bounds change. Keep the coherent 16-field top-level response and keep public
  document-integrity certificate protocol v1 unchanged.
- Reuse the retained `CommentSourceSet`, `StorySlot`, each realization's
  `visitedEvents`, and the selected Comments realization. Perform no new
  package read, extraction, XML parse, relationship traversal, or story
  discovery.
- In one bounded, stack-safe event-order pass over each side's retained physical
  stories, collect comment range starts, range ends, and references with
  explicit counters. Do not use `zipIdx`, copy whole event lists, or run
  quadratic per-event filters.
- Extend each comment inventory with range-start and range-end occurrence
  counts. Require each canonical ID admitted from a reference or range marker
  to have exactly one reference and exactly one selected direct definition;
  continue permitting unique unreferenced definitions. Permit zero endpoints
  as a point comment; otherwise require exactly one start and one end in the
  same retained physical story as the reference, with the start event ordinal
  less than the end event ordinal.
- Permit same-paragraph ranges, cross-paragraph ranges, and crossing ranges.
  Reject malformed or overlong IDs, duplicate references or endpoints, orphan
  endpoints, reversed endpoints, cross-story markers, missing reference or
  definition association, incomplete scans, and resource crossings with
  deterministic bounded evidence.
- Extend independent byte-native typed semantics, exact theorem signatures,
  executable refinements, the strict TypeScript decoder, additive certificate
  evidence, protocol charging/envelope proofs, differential tests, and the full
  real NVCA-derived production path. Semantic targets remain axiom-free;
  executable refinements and the production theorem may use only the exact
  existing foundational axioms. All Lean files remain free of `sorry`.
- Update conformance coverage for ECMA-376 5th edition Part 1
  §§17.13.4.3, 17.13.4.4, 17.13.4.5, and 17.18.10, while inheriting the
  existing §17.13.4.2 and §17.13.4.6 definition/root evidence. Record
  orphan-endpoint rejection as a deliberate stronger-profile
  `@conformance-gap`, and do not claim complete ECMA coverage.

## Impact

- Affected specs: `docx-comparison`, `spec-compliance`
- Affected code after approval: Lean comment semantics/scanner/protocol and
  audits; TypeScript strict decoder and certificate types; focused,
  differential, real-DOCX, stack, memory, and conformance tests; coverage
  registry and generated projections
- Compatibility: private protocol v6 migrates to v7; public certificate
  protocol v1 keeps every existing required field and literal unchanged,
  including `commentStoryScope.rangeTopology: false`; protocol-v7 evidence is
  exposed only through optional `checkerProtocolVersion: 7`, optional topology
  profile evidence, optional inventory counts, and bounded failures.
  Downstream users still do not install Lean
- Retained scope: Transitional legacy comments in admitted main,
  header/footer, footnote, and endnote physical stories for inplace comparison
- Explicit exclusions: modern/threaded comments and their extension parts;
  author, date, initials, content, rendering, replies, and resolved state;
  Strict namespaces; rebuild certification; visual layout; and any nesting or
  non-crossing restriction
- Refs: #729, #672, #710, #547
