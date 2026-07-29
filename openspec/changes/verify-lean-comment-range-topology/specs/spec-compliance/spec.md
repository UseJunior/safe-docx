## ADDED Requirements

### Requirement: Legacy comment range coverage states the normative boundary

The coverage registry SHALL bind Transitional legacy comment range-marker and
reference ID claims to ECMA-376 5th edition Part 1 §§17.13.4.3,
17.13.4.4, 17.13.4.5, and 17.18.10, with exact vendored declarations for
`commentRangeEnd`, `commentRangeStart`, `commentReference`,
`CT_MarkupRange`, `CT_Markup`, `w:id`, and `ST_DecimalNumber`. It SHALL inherit
the existing selected comments-root/direct-definition evidence for
§§17.13.4.2 and 17.13.4.6 without claiming new coverage for those sections.

#### Scenario: ID typing is cited as ECMA-backed
- **WHEN** protocol-v7 range coverage is generated
- **THEN** range-start, range-end, and reference `w:id` typing SHALL trace
  through the vendored Transitional schemas to `ST_DecimalNumber`
- **AND** eligible implementation sites and tests SHALL cite only the exact
  exercised sections with `@conformance` and structured conformance labels
- **AND** retained path, source-scope, ordering, resource, protocol, and
  certificate policies SHALL remain identified as Safe-DOCX policy

### Requirement: Orphan-endpoint rejection is recorded as a stronger profile

Coverage SHALL state that ECMA prose permits an unmatched
`w:commentRangeStart` or `w:commentRangeEnd` to act as a point anchor. The
Safe-DOCX requirement that a nonempty endpoint set contain exactly one start
and one end SHALL be recorded as a deliberate stronger verification profile
and conformance gap, not as an ECMA pairing requirement.

#### Scenario: Coverage does not overclaim endpoint pairing
- **WHEN** generated conformance documentation describes orphan endpoint
  rejection
- **THEN** it SHALL identify the paired-or-point rule as Safe-DOCX policy
- **AND** the implementing declaration SHALL use the repository's
  `@conformance-gap` mechanism with the exact cited sections and rationale
- **AND** tests for orphan rejection SHALL NOT label the rejection itself as
  ECMA-conformant behavior
- **AND** a unique definition/reference with zero endpoints SHALL remain a
  standards-aligned accepted point comment

### Requirement: Range coverage preserves explicit exclusions

The coverage machinery SHALL preserve explicit exclusions in the registry,
generated conformance document, capability projection, and public claim. Those
exclusions are modern and threaded comments; author, content, rendering, reply,
and resolved-state semantics; Strict namespaces; rebuild certification; visual
layout; and any nesting or non-crossing restriction. The resulting materials
SHALL NOT claim complete ECMA-376 coverage.

#### Scenario: Crossing and cross-paragraph ranges are not gaps
- **GIVEN** two valid ranges cross or one valid range spans paragraphs within a
  retained physical story
- **WHEN** coverage and tests describe the behavior
- **THEN** the cases SHALL remain accepted
- **AND** no unsupported nesting or paragraph-local requirement SHALL be added

### Requirement: Comment topology proof targets have exact audits

The seven protocol-v7 byte-native semantic targets pinned in the design SHALL
have empty normalized axiom sets and no transitive `String`,
`String.toUTF8`, `Lean.Json`, `IO`, production, residual, or LeanSpike
dependency. Separately named executable refinements and the production theorem
SHALL use the six complete propositions pinned in the design and exactly the
existing foundational set
`[propext, Classical.choice, Quot.sound]`; the normalized whole-file union SHALL
remain the existing exact six-name allowlist. All Lean source SHALL remain free
of `sorry`.

#### Scenario: Audits reject detached or inefficient evidence
- **WHEN** signatures, imports, transitive dependencies, axioms, and scanner
  closure are audited
- **THEN** the independent marker scan SHALL quantify over all retained typed
  stories/events and all IDs from starts, ends, references, and definitions
- **AND** the production refinement SHALL bind the exact retained
  `CommentSourceSet`, `StorySlot`, `visitedEvents`, selected Comments
  realization, one-call scan, inventory, issues, canonical bytes, and stdout
- **AND** omitted/substituted events, detached realizations, caller-supplied
  inventories, hidden endpoint-only IDs, inherited-field drift, and encoder
  drift SHALL fail
- **AND** a unique direct-definition-only ID SHALL remain a positive
  axiom-free witness with one unreferenced definition and no topology issue
- **AND** audited production scanning SHALL contain no package/event-sized list
  conversion, copied whole-event-list projection, `zipIdx`, or quadratic
  per-event filtering
- **AND** missing-required and forbidden-extra audit self-tests SHALL fail as
  expected

### Requirement: Protocol-v7 coverage includes executable resource evidence

Coverage acceptance SHALL include strict decoder mutation tests, exact
terminal/coalescing/charge/envelope proofs, focused and real-DOCX topology
tests, and the complete NVCA-derived TypeScript-to-compiled-Lean production
path under fixed resource limits.

#### Scenario: CI audits exact production limits
- **WHEN** protocol-v7 conformance and coverage gates run
- **THEN** the complete production path SHALL use a fixed 8 MiB process stack,
  a 120-second per-invocation timeout, and a checker peak-RSS ceiling below
  1.5 GiB
- **AND** point, same-paragraph, cross-paragraph, crossing, all retained
  stories, malformed/overlong/alias, orphan/reverse/duplicate,
  cross-story/missing-association, unique unreferenced definition, incomplete,
  and resource-limit cases SHALL be covered
- **AND** independent review and exact-main post-merge smoke SHALL confirm the
  normative boundary and production behavior
- **AND** no acceptance path SHALL invoke LibreOffice/soffice or `lake update`
