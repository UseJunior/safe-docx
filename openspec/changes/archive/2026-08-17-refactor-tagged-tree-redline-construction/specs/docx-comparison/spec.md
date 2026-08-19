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
  exactly one node of input side `s`. An explicitly opaque subtree counts as a
  single atomic input unit and its descendants are not separately accounted;
- **P2 order**: sibling order in `project(tree, s)` equals sibling order in
  input side `s`;
- **P3 containment**: parent/child relationships are preserved, so a projected
  node's parent is the projection of its tree parent;
- **P4 content**: side-specific namespace, name, attributes and text are those
  of side `s`'s representative. Element identity SHALL be namespace URI plus
  local name, never the lexical qualified name, because prefixes are aliasable;
- **P5 opaque payload**: a subtree the engine explicitly declines to model is
  carried through equivalent to the input subtree it stands for.

A subtree the engine does not model SHALL be marked opaque **explicitly**. The
absence of modeled children SHALL NOT be interpreted as a declaration of
opacity, because that is also what an incomplete construction looks like: a
representation that cannot distinguish "not modeled deliberately" from "not
modeled by mistake" certifies the second as the first.

P5 equivalence is **canonical, not byte-level**: attribute order is normalized,
adjacent text nodes are concatenated, CDATA and text are treated alike, and
comments and processing instructions do not participate. Content depending on
those distinctions SHALL NOT be modeled as opaque payload.

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

#### Scenario: An unmodeled subtree must declare itself opaque

- **GIVEN** a tree node whose input element has child elements
- **WHEN** the node carries no modeled children and is not marked opaque
- **THEN** the contract SHALL report a P1 violation naming the unaccounted children
- **AND** the same shape marked opaque SHALL verify clean

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
- **multi-author relationships**: the model SHALL retain the ordered prior
  revision stacks from both representatives and SHALL define how comparison
  revisions nest relative to them.

After a tagged-tree serializer exists, accept and reject over serialized stacked
revisions from several authors SHALL agree with the corresponding tree
projections. This serialized evidence SHALL pass before offline corpus evidence
is treated as complete.

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

#### Scenario: Serialized multi-author stacks preserve both projections

- **GIVEN** a tagged tree retaining ordered revision stacks from several authors
- **WHEN** the offline serializer emits tracked markup and accept/reject are applied
- **THEN** accept SHALL reproduce the revised tree projection
- **AND** reject SHALL reproduce the original tree projection

### Requirement: Tagged-tree construction is the default with an explicit legacy rollback

The ordinary comparison pipeline SHALL use tagged-tree construction by default.
Callers SHALL be able to request the legacy construction explicitly for one
release-cycle rollback window ending 2026-11-16. Legacy removal SHALL proceed
on or after that date once #837 has shipped and #838's release-evidence gate is
complete; if either gate remains incomplete, continued availability SHALL
require a new dated extension decision. Existing runtime safety checks — text, bookmark,
field structure, ancillary story, relationship closure, and package integrity —
SHALL remain in force for both strategies. The public `rebuild` mode SHALL
remain available and unchanged.

The offline harness SHALL continue recording divergence between the two constructions across the
formatting-fidelity corpus, the multi-author fixtures, the OpenAgreements and
NVCA/ILPA templates, and the pinned engine-bug characterization cases.

Divergence SHALL be assessed on projections and fidelity scores rather than
output bytes. A divergence that is not projection-equivalent SHALL be reported
as blocking. A divergence that is projection-equivalent but textually different
SHALL be recorded for individual review and either accepted with a rationale or
pinned as a characterization case.

#### Scenario: Tagged-tree is default with legacy rollback

- **GIVEN** a document pair and no comparison-strategy override
- **WHEN** the pair is compared through the ordinary pipeline
- **THEN** the tagged-tree strategy SHALL construct the returned redline
- **AND** an explicit legacy strategy SHALL remain available as a rollback
- **AND** every existing runtime safety check SHALL still run

#### Scenario: Tagged-tree publication failure returns the validated legacy redline

- **GIVEN** tagged-tree is the requested or default strategy
- **AND** its publication candidate fails an existing runtime safety check
- **WHEN** the legacy candidate has already passed its applicable validation
- **THEN** the pipeline SHALL return the legacy redline instead of throwing
- **AND** SHALL report tagged-tree as requested and legacy as used
- **AND** SHALL report a stable fallback reason and the failed-check diagnostics
- **AND** reconstruction-mode fallback metadata SHALL remain unchanged

#### Scenario: Legacy rollback reaches its sunset

- **GIVEN** the date is on or after 2026-11-16
- **AND** #837 has shipped and #838's release-evidence gate is complete
- **WHEN** comparison strategy support is evaluated
- **THEN** the legacy strategy and automatic fallback SHALL be removed
- **AND** an unmet gate SHALL require an explicit dated extension decision

#### Scenario: Divergence is recorded with fixture identity

- **GIVEN** a controlled offline corpus run
- **WHEN** the two constructions differ
- **THEN** the report SHALL name the fixture and the diverging projection
- **AND** SHALL classify the divergence as projection-inequivalent (blocking) or
  projection-equivalent (for review)
