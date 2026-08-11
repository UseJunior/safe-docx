## ADDED Requirements

### Requirement: Side-tagged comparison tree carries both side representatives

The comparison engine SHALL provide a side-tagged tree representation of a
compared document pair in which every node carries a tag of `both`, `original`,
or `revised`.

A `both`-tagged node SHALL hold **two** element representatives — one for the
original side and one for the revised side — because two nodes may be matched
without being identical. It MAY additionally carry a scoped property delta
recording a formatting difference between those representatives.

A property delta SHALL be scoped to the OOXML property level it describes — run
(`w:rPr`), paragraph mark (`w:pPr/w:rPr`), paragraph (`w:pPr`), table row or
cell (`w:trPr` / `w:tcPr`), or section (`w:sectPr`) — and SHALL record a direct
property snapshot of each side. It SHALL NOT record formatting resolved through
the style chain or `docDefaults`; effective-formatting fidelity is out of scope
for this representation.

Content that is textually identical on both sides SHALL be tagged `both` and
SHALL NOT be represented as a deletion paired with an insertion.

#### Scenario: Matched-but-differing nodes retain both representatives

- **GIVEN** a run whose text is identical on both sides but whose direct run properties differ
- **WHEN** the pair is aligned into the tagged tree
- **THEN** the node SHALL be tagged `both` with distinct original and revised representatives
- **AND** it SHALL carry a run-scoped property delta holding each side's direct `w:rPr` snapshot

#### Scenario: Property delta scope matches the property level

- **GIVEN** a paragraph whose `w:pPr` differs between sides while its runs are unchanged
- **WHEN** the pair is aligned
- **THEN** the delta SHALL be recorded at paragraph scope, not run scope

#### Scenario: Equal content is tagged both

- **GIVEN** an original and revised document containing an identical run of text
- **WHEN** the pair is aligned
- **THEN** the corresponding node SHALL be tagged `both`
- **AND** no delete/insert representation of that content SHALL be produced

### Requirement: Each projection is isomorphic to its input side

The engine SHALL define `project(tree, side)` as a total fold retaining nodes
tagged `both` or `side`, and the aligner SHALL satisfy a projection-isomorphism
contract for each side `s`:

- **P1 bijection**: every node of input side `s` corresponds to exactly one tree
  occurrence tagged `both` or `s`, and every such occurrence corresponds to
  exactly one node of input side `s`;
- **P2 order**: sibling order in `project(tree, s)` equals sibling order in
  input side `s`;
- **P3 containment**: parent/child relationships are preserved, so a projected
  node's parent is the projection of its tree parent;
- **P4 content**: side-specific text, attributes, and properties are those of
  side `s`'s representative;
- **P5 opaque payload**: subtrees the engine does not model are reproduced
  byte-identically on the side they came from.

Coverage and multiplicity alone SHALL NOT be treated as sufficient. An
obligation stating only that each input node appears exactly once admits
`original = [A, B]`, `revised = [B, A]`, tree `[both(B), both(A)]`, whose
original projection is `[B, A]` rather than `[A, B]`; P2 is what excludes it.

P1-P5 SHALL be checkable against the tree without serializing it.

The contract SHALL be scoped to **IR projection fidelity**. It SHALL NOT be
represented as establishing serializer correctness, accept/reject semantics, or
package and story assembly correctness, each of which is a separate layer with
its own evidence.

#### Scenario: Projections reproduce their input sides

- **GIVEN** any aligned pair
- **WHEN** `project(tree, 'original')` and `project(tree, 'revised')` are evaluated
- **THEN** each SHALL be isomorphic to its input side under P1-P5

#### Scenario: Reordering that satisfies coverage is rejected

- **GIVEN** an original side ordered `[A, B]` and a revised side ordered `[B, A]`
- **WHEN** a candidate tree orders them `[both(B), both(A)]`
- **THEN** the contract SHALL reject the candidate for violating P2
- **AND** the violation SHALL be reported without requiring serialization

#### Scenario: Contract violations name the offending node

- **WHEN** the P1-P5 checks run against a constructed tree
- **THEN** a violation SHALL raise a distinguishable error naming the failing
  obligation and the offending node
- **AND** the failure SHALL NOT be repaired by a downstream pass

### Requirement: Pre-existing tracked changes are represented by construction invariants

The tagged tree SHALL represent tracked-change markup already present in either
input (`w:ins` / `w:del` from prior authors) under explicit invariants rather
than as opaque transported payload, because the engine splits runs along
provenance boundaries and seeds revision identifiers across preserved roots.

The representation SHALL specify:

- **provenance splitting**: where a comparison-side boundary falls inside a
  pre-existing revision, the split SHALL preserve that revision's author and
  date on every resulting fragment;
- **nesting**: which projection unwraps a comparison revision nested inside a
  pre-existing one;
- **revision-identifier allocation**: identifiers SHALL NOT collide with any
  already present in either input;
- **multi-author resolution**: accept and reject over stacked revisions from
  several authors SHALL agree with the reject-projection oracle.

These invariants SHALL be evidenced on the multi-author corpus before the
representation is exercised on any other class of input.

#### Scenario: Provenance survives a boundary split

- **GIVEN** an original document carrying `w:ins` markup from a prior author
- **AND** a comparison-side boundary falling inside that insertion
- **WHEN** the pair is aligned
- **THEN** every resulting fragment SHALL retain the prior author's attribution and date

#### Scenario: Allocated revision identifiers avoid input collisions

- **GIVEN** inputs that already contain revision identifiers
- **WHEN** the tree allocates identifiers for the comparison's own revisions
- **THEN** no allocated identifier SHALL equal one present in either input

### Requirement: The tagged-tree path runs in shadow and changes no behavior

The tagged-tree representation SHALL run beside the existing pipeline behind an
opt-in shadow mode, and SHALL NOT supply the output of any comparison while this
requirement is in force. Existing runtime safety checks — text, bookmark, field
structure, and ancillary story — SHALL remain in place unchanged.

Shadow mode SHALL record divergence between the two constructions across the
formatting-fidelity corpus, the multi-author fixtures, the OpenAgreements and
NVCA/ILPA templates, and the pinned engine-bug characterization cases.

Divergence SHALL be assessed on projections and fidelity scores rather than
output bytes. A divergence that is not projection-equivalent SHALL be reported
as blocking. A divergence that is projection-equivalent but textually different
SHALL be recorded for individual review and either accepted with a rationale or
pinned as a characterization case.

#### Scenario: Shadow mode does not affect returned output

- **GIVEN** shadow mode enabled
- **WHEN** a document pair is compared
- **THEN** the returned output SHALL be the existing pipeline's output, unchanged
- **AND** every existing runtime safety check SHALL still run

#### Scenario: Divergence is recorded with fixture identity

- **GIVEN** a corpus run in shadow mode
- **WHEN** the two constructions differ
- **THEN** the report SHALL name the fixture and the diverging projection
- **AND** SHALL classify the divergence as projection-inequivalent (blocking) or
  projection-equivalent (for review)
