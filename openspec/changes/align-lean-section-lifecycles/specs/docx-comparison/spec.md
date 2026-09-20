## MODIFIED Requirements

### Requirement: Relationship stories align deterministically by logical slot

The verifier SHALL align original, revised, and compared bindings by logical
slot `(projectedSectionOrdinal, kind, role)`. It SHALL retain relationship IDs,
normalized package paths, physical compared section ordinals, lifecycle, and
source projected ordinals as evidence and SHALL NOT use text, relationship ID,
target path, or LCS as cross-package section identity.

Protocol v8 SHALL derive section insertion solely from this exact compared-main
paragraph-boundary shape:

1. one direct `w:pPr` child of a direct body `w:p`;
2. one direct `w:sectPr` and at most one direct `w:rPr` child of that `w:pPr`;
3. for `inserted`, exactly one direct `w:ins` and no direct `w:del` child of
   that sole `w:rPr`; and
4. no other `w:ins` or `w:del` descendant of that boundary `w:pPr`.

The classifier SHALL apply the following precedence and emit at most one
lifecycle issue per physical compared section:

| Priority | Observed boundary shape | Result/code |
| ---: | --- | --- |
| 1 | not exactly one direct `w:pPr` or `w:sectPr`, or more than one direct `w:rPr` | `AMBIGUOUS_SECTION_STRUCTURE` |
| 2 | any direct `w:del` in the sole direct `w:rPr` | `UNSUPPORTED_SECTION_DELETION` |
| 3 | both direct marker kinds or more than one direct `w:ins` | `AMBIGUOUS_SECTION_LIFECYCLE` |
| 4 | any `w:ins`/`w:del` descendant outside the permitted direct `w:rPr` path | `UNSUPPORTED_SECTION_LIFECYCLE` |
| 5 | exactly one permitted direct `w:ins` | `inserted` |
| 6 | otherwise | `stable` |

Self-closing and explicit-empty markers SHALL classify identically.
`w:pPrChange`, `w:sectPrChange`, move elements, and other revision elements
without `w:ins`/`w:del` SHALL be irrelevant to boundary presence. An
`w:ins`/`w:del` nested inside their snapshots SHALL trigger priority 4. Markers
in another paragraph SHALL affect only that paragraph. A direct body-level
terminal `w:sectPr` SHALL be stable. Each lifecycle issue SHALL carry exact
keys `code`, `detail`, and `comparedSectionOrdinal`; `detail` SHALL be bounded
to 256 UTF-8 bytes, issues SHALL order by physical compared section ordinal,
and duplicate evidence for the same section SHALL coalesce to the highest
priority code.

The compared inventory SHALL retain a zero-based physical section ordinal and
derive contiguous zero-based reject/original and accept/revised projections in
document order. Stable sections SHALL occur in both projections. Inserted
sections SHALL occur only in the accept/revised projection. Deleted-section
success is outside protocol v8; priority 2 fails closed until production issue
#754 supplies tracked deletion evidence.

The reject projection's count and ordered explicit `(kind, role)` inventory
SHALL equal original; the accept projection's SHALL equal revised. Any
post-projection mismatch SHALL be a structured failure. Remaining ordinally
aligned target permutations SHALL be checked as their actual XML triples. The
verifier SHALL NOT claim semantic identity or permutation detection among
selector-indistinguishable stable sections.

Every logical slot SHALL have exact keys `slotOrdinal`,
`comparedSectionOrdinal`, `sectionLifecycle`, `kind`, `role`, `original`,
`revised`, `compared`, and `physicalStoryOrdinal`. A slot side SHALL be exactly:

```ts
type RelationshipSlotSide =
  | {
      present: false;
      relationshipResolutionInvocations: 0;
    }
  | {
      present: true;
      sectionOrdinal: number;
      relationshipId: string;
      normalizedPartPath: string;
      relationshipResolutionInvocations: 1;
    };
```

Revised and compared SHALL always be present. Original SHALL be absent if and
only if lifecycle is `inserted`; otherwise all sides SHALL be present. Present
source ordinals SHALL equal their projected section ordinal; compared
`sectionOrdinal` SHALL equal `comparedSectionOrdinal`. Relationship resolution
SHALL occur and be counted once for every present logical slot side before
physical-story deduplication; an absent slot side SHALL perform and report no
relationship resolution.

Logical evidence SHALL order compared section ordinal ascending, header before
footer, and role first, default, then even. Slot ordinals SHALL be contiguous.
Physical checks SHALL deduplicate if and only if kind plus the exact
original/revised/compared side-presence/path tuple matches, while retaining
every selecting logical slot exactly once in canonical order. Physical-story
ordinals SHALL be contiguous.

#### Scenario: [LEAN-REL-03] Side-specific identities align by slot

- **GIVEN** one stable logical slot uses different valid relationship IDs and
  normalized target paths in the three packages
- **WHEN** protocol v8 assembles its relationship story
- **THEN** the story SHALL align by projected section ordinal, kind, and role
- **AND** the report SHALL retain all three side-specific IDs and paths

#### Scenario: [LEAN-REL-04] Selector-observable section differences fail closed

- **WHEN** projected section counts differ or ordered direct slot inventories
  differ
- **THEN** verification SHALL fail with a structured section alignment issue
- **AND** no LCS, target-path match, relationship-ID match, or text match SHALL
  manufacture an alignment
- **AND** no claim SHALL be made about semantic identity or permutations of
  selector-indistinguishable sections

#### Scenario: [LEAN-REL-05] Shared targets check once without losing selectors

- **GIVEN** multiple logical slots select the same kind and exact complete
  three-side presence/path tuple
- **WHEN** the collection is assembled
- **THEN** the physical XML work SHALL execute once
- **AND** its evidence SHALL list every selecting logical slot in canonical
  order

#### Scenario: [LEAN-REL-LIFE-01] Inserted section aligns both projections

- **GIVEN** original has one stable section, revised has an additional
  paragraph-boundary section, and compared carries the exact direct insertion
  shape
- **WHEN** protocol v8 projects and aligns section inventories
- **THEN** reject-projected compared SHALL equal original
- **AND** accept-projected compared SHALL equal revised
- **AND** every inserted slot's original side SHALL be explicitly absent

#### Scenario: [LEAN-REL-LIFE-02] Lifecycle precedence is deterministic

- **GIVEN** one compared boundary contains multiple structural or lifecycle
  defects
- **WHEN** protocol v8 classifies it
- **THEN** exactly the highest-priority applicable lifecycle issue SHALL be
  emitted for that physical section
- **AND** no slot from that section SHALL receive passing evidence

#### Scenario: [LEAN-REL-LIFE-03] Deleted section remains fail-closed

- **GIVEN** a paragraph-boundary section has a direct deletion marker
- **WHEN** protocol v8 classifies it
- **THEN** it SHALL emit `UNSUPPORTED_SECTION_DELETION`
- **AND** it SHALL NOT infer an absent revised story or passing evidence

## ADDED Requirements

### Requirement: Protocol v8 binds lifecycle stories to exact work evidence

This change SHALL depend on completion and archival of
`verify-lean-comment-range-topology`. Protocol v8 SHALL preserve that change's
exact 16-field top-level response grammar, field order, inherited issue order,
ordinary/terminal envelope behavior, comment topology evidence, and public-v1
semantics. It SHALL change only the nested relationship slot/story schemas,
selection issue union, source partitions, checker identity, and protocol
version specified here. The checker identity SHALL be
`safe-docx-lean-section-lifecycle-comment-range-integrity-checker`; request and
response `protocolVersion` SHALL be exactly 8; protocol v7 output SHALL be
`not_run` under the v8 producer.

Every physical story SHALL have exact keys `physicalStoryOrdinal`, `kind`,
`original`, `revised`, `compared`, `selectingSlotOrdinals`, and `report`.
Each side SHALL use exactly this work union:

```ts
type RelationshipStorySideWork =
  | {
      present: false;
      extractionInvocations: 0;
      parseInvocations: 0;
      compressedBytes: 0;
      expandedBytes: 0;
      xmlEventCount: 0;
      tokenCount: 0;
    }
  | {
      present: true;
      normalizedPartPath: string;
      zipEntryIndex: number;
      extractionInvocations: 1;
      parseInvocations: 1;
      compressedBytes: number;
      expandedBytes: number;
      xmlEventCount: number;
      tokenCount: number;
    };
```

Only inserted/original MAY be absent. Proven absence SHALL contribute empty
tokens and zero physical work. Every present physical-story side SHALL identify
exactly one regular ZIP entry, extract once, parse once, be charged once per
deduplicated physical work item, and expose its actual counts. Relationship
resolution SHALL instead be evidenced per logical slot side as required by the
modified selector contract. The report's parsed token counts SHALL equal the
three physical-story side `tokenCount` values.

For each side, selected relationship work SHALL satisfy:

- at most 256 unique present selected paths;
- each present part at most 8 MiB compressed, 16 MiB expanded, and 500,000 XML
  events;
- main plus all present relationship/fixed/comment work at most 16 MiB
  compressed, 32 MiB expanded, and 1,000,000 XML events;
- across three packages, at most 768 selected parts, 48 MiB compressed,
  96 MiB expanded, and 3,000,000 XML events; and
- sums count each admitted present deduplicated physical work item exactly
  once, count absent branches zero times, and retain the protocol-v7 fixed
  overhead and terminal-collapse constants unchanged.

Lean SHALL enforce the inherited whole-request side/triple resource sums and
caps using its request-bound main, relationship, fixed-story, note, and comment
measurements. Protocol v8 SHALL NOT add a duplicate aggregate/base-resource
record to the unchanged 16-field response merely to restate those internal
measurements.

The strict TypeScript decoder SHALL enforce exact keys/key order, safe integer
and per-part caps on every exposed relationship-story measurement,
presence/lifecycle equations, per-slot relationship-resolution equations,
physical-story extraction/parse equations, token equality, deduplication keys,
selector bijection, contiguous ordinals, canonical ordering, the inherited
16-field grammar and output envelopes, and the aggregate `passed` equation. It
SHALL NOT claim to recompute unexposed inherited whole-request side/triple
resource sums. Lean SHALL prove the exposed work records equal request-bound
relationship resolution, ZIP index, extraction, and parser evidence;
TypeScript consistency is a second boundary check, not the source of truth.

#### Scenario: [LEAN-REL-LIFE-04] Proven absence is zero work and zero tokens

- **GIVEN** an aligned inserted footer has absent original and present revised
  and compared sides
- **WHEN** protocol v8 checks the physical story
- **THEN** original SHALL have every work counter and token count equal zero
- **AND** reject(compared) SHALL equal empty original tokens
- **AND** every present logical slot side SHALL resolve exactly once
- **AND** every present deduplicated physical-story side SHALL be request-bound,
  loaded, charged, and checked exactly once

#### Scenario: [LEAN-REL-LIFE-05] Work mutations fail closed

- **WHEN** any exposed presence, path, ZIP identity, invocation count,
  byte/event/token count, selector, ordinal, deduplication, per-part cap, or
  inherited envelope equation is mutated
- **THEN** Lean or the strict TypeScript decoder SHALL fail closed
- **AND** no public passing claim SHALL survive

#### Scenario: [LEAN-REL-LIFE-06] Internal aggregate resource limits fail closed

- **WHEN** request-bound main, relationship, fixed-story, note, or comment work
  causes an inherited whole-request side or triple resource cap to be exceeded
- **THEN** Lean SHALL fail closed before emitting passing evidence
- **AND** the TypeScript decoder SHALL NOT claim to have independently
  recomputed measurements that are not present in the 16-field response

### Requirement: Lifecycle-aware note and comment source partitions are bijective

For each package side, the note-reference source partition SHALL be exactly
`[main] ++ present relationship physical stories` in ascending global
`physicalStoryOrdinal`. Its `sourceOrdinal` SHALL be the contiguous array
index; main SHALL be zero; each relationship source SHALL retain global
physical-story ordinal, kind, and normalized path. Every present relationship
story SHALL occur exactly once; absent stories SHALL occur zero times.

For each package side, the comment-reference `CommentSourceSet` SHALL be
exactly the complete note-reference partition followed by the present
footnotes definition story and then the present endnotes definition story.
Those note-definition sources SHALL retain their semantic kind and normalized
path and SHALL receive the next contiguous source ordinals. Comments content
SHALL remain a definition story, not a reference source.

Selection, resolution, ZIP identity, extraction, UTF-8/XML parsing,
fully-scanned evidence, ordering, cardinality, work-accounting, or either
bijection failure SHALL make the corresponding partition incomplete and make
comment topology `not_evaluated`. Lifecycle-proven absence alone SHALL NOT.
Protocol v8 SHALL preserve protocol v7's one-pass retained comment event scan
over the resulting complete `CommentSourceSet`; no package/part/parser work
SHALL be repeated.

#### Scenario: [LEAN-REL-LIFE-06] Note partition contains each present relationship story

- **WHEN** protocol v8 emits a side's note-reference partition
- **THEN** it SHALL contain main followed by exactly every relationship story
  present on that side in global physical-story order
- **AND** source ordinals SHALL be contiguous and absent stories SHALL not
  appear

#### Scenario: [LEAN-REL-LIFE-07] Comment partition appends present note stories

- **WHEN** protocol v8 constructs a side's comment reference sources
- **THEN** it SHALL preserve the complete note-reference partition
- **AND** append present footnotes then present endnotes exactly once
- **AND** the retained v7 marker scan SHALL visit that exact source sequence

### Requirement: Public certificate v1 reports lifecycle evidence without weakening prior claims

The public certificate SHALL remain protocol v1 and preserve every existing
field, literal, compatibility rule, five-field relationship co-presence rule,
comment-topology field, rebuild behavior, status meaning, and exclusion from
the canonical protocol-v4/v5/v6 requirements and the protocol-v7 comment-range
change.

`checkerProtocolVersion` SHALL widen additively to include `8`.
`DocumentIntegrityRelationshipScope.alignment` SHALL add the literal
`"reject-original-accept-revised-section-lifecycle"`. Protocol v8 SHALL expose
the exact lifecycle slot/story presence, projected ordinals, paths, token
counts, selectors, and source partitions specified above. Internal work/ZIP
charges SHALL remain verifier evidence and SHALL NOT expose host paths,
filenames outside normalized package paths, document bytes, text, values, or
hashes in the public certificate.

A current protocol-v8 producer SHALL emit all inherited required v7 public
evidence and all lifecycle relationship fields together or none. Partial,
contradictory, noncanonical, malformed, timed-out, unbounded, or older-labeled
v8 output SHALL be `not_run`. Structured lifecycle, selection, partition,
comment-topology, or story failure SHALL be `failed`. Rebuild SHALL remain
`not_applicable`.

#### Scenario: [LEAN-REL-LIFE-08] Protocol v8 preserves prior certificate contracts

- **WHEN** a consumer reads a legacy public-v1 certificate or current
  protocol-v8 evidence
- **THEN** every preexisting field and omission rule SHALL retain its meaning
- **AND** lifecycle evidence SHALL be additive and all-or-none
- **AND** no internal host path, source text, value, or document hash SHALL be
  introduced by lifecycle evidence

### Requirement: Inserted-section verification has compiled and redistributable real-DOCX evidence

Tests SHALL preserve all existing protocol-v4 relationship-story and
protocol-v7 comment-range evidence. Protocol v8 tests SHALL exercise the actual
compiled executable and strict launcher for stable, inserted,
deletion-rejected, ambiguous, misplaced, unexplained, presence-union, work,
selector, note-partition, comment-partition, resource, and envelope cases.

The real regression SHALL use
`tests/test_documents/open-agreements/common-paper-mutual-nda.docx`, pinned at
SHA-256
`9a61c5b6acee7248df24ddd157c039fc6918230aee8ccbd2627cd6f7c4d9a492`.
Before implementation, the repo SHALL add an adjacent provenance manifest
recording: Common Paper Mutual NDA; official source
`https://github.com/CommonPaper/Mutual-NDA`; source version; CC BY 4.0;
redistribution and derivatives permitted with attribution; derivative status;
and attribution `Copyright Common Paper, Inc.; licensed CC BY 4.0`. The test
SHALL add no confidential or restricted fixture.

In a focused integration test, a deterministic helper SHALL clone that
Word-authored package and add one revised paragraph-boundary section, one
explicit footer binding, one package-internal footer relationship, content
type coverage, and one parser-supported footer part. Production comparison
SHALL create the compared revision markers in true in-place mode; the helper
SHALL NOT author compared markers. Production accept/reject through
`trackChangesAcceptorAst.ts` SHALL be exact before verifier evidence is
accepted.

The test SHALL require a nonzero inserted-footer certificate, all six generic
story checks, the inherited protocol-v7 comment topology checks, complete note
and comment partitions, and no lifecycle/section/slot issue. Mutations SHALL
cover every classifier row, presence/work union field, projected/global/source
ordinal, selector/story/partition bijection, note-story append, resource
equation, protocol version, and inherited envelope rule.

The compiled suite, theorem/axiom audits, zero-`sorry` audit, drift witnesses,
coverage ledger, and this redistributable real-DOCX test SHALL be wired into
Lean CI.

#### Scenario: [LEAN-REL-LIFE-09] Word-authored inserted footer receives a complete certificate

- **GIVEN** the deterministic Common Paper-derived inserted-section/footer pair
- **WHEN** production creates a true in-place comparison and protocol v8 checks
  the package triple
- **THEN** production accept/reject SHALL be exact
- **AND** every main and selected-story generic check SHALL pass
- **AND** inherited comment topology and both source partitions SHALL pass

#### Scenario: [LEAN-REL-LIFE-10] Compiled trust boundary rejects mutations

- **WHEN** any lifecycle, presence, work, ordinal, selector, source partition,
  resource, inherited topology, envelope, or version mutation is applied
- **THEN** the compiled checker or strict launcher SHALL fail closed
- **AND** CI SHALL execute the actual compiled boundary
