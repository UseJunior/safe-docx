## Context

The current selector inventories direct `w:sectPr` elements and requires raw
three-side ordinal equality. Production in-place comparison can instead emit:

```xml
<w:p>
  <w:pPr>
    <w:rPr><w:ins .../></w:rPr>
    <w:sectPr>...</w:sectPr>
  </w:pPr>
</w:p>
```

The `w:sectPr` is not inside `w:ins`; the direct paragraph-mark insertion is
the evidence that this boundary exists only after accepting changes. Pair C
already has exact production accept/reject behavior and passes all six main
story checks after #748, but protocol v6 stops at raw section-count mismatch.

Deletion is not symmetric today. Production accept retains an ancillary story
whose section was removed and supplies no trustworthy deletion-side story
carrier. #754 owns that engine work. Treating deletion as verifier-only empty
tokens would certify something production did not represent.

## Goals / Non-Goals

Goals:

- certify the exact supported inserted-boundary shape;
- align reject(compared) with original and accept(compared) with revised;
- make absence, work, tokens, ordinals, partitions, and budgets explicit;
- preserve strict decoding, bounded evidence, deterministic ordering, and
  proof/audit coverage;
- prove the behavior with an existing publicly sourced Word-authored fixture.

Non-goals:

- deleted-section certificate success (#754);
- arbitrary slot insertion/removal within a stable section;
- heuristic matching, inherited roles, pagination, rendering, or field
  evaluation;
- new ZIP/XML admission, rebuild certification, or private-corpus fixtures.

## Decisions

### 1. Exact insertion classifier

For a supported paragraph boundary, the streaming inventory records direct
child counts for `w:pPr`, its direct `w:rPr` and `w:sectPr`, direct insertion
and deletion children of that `w:rPr`, and any revision descendant of the
boundary `w:pPr` outside the permitted path.

The normative classifier table fixes precedence. Duplicate structural nodes
win first, deletion second, contradictory/repeated direct markers third,
misplaced insertion/deletion descendants fourth, exact insertion fifth, and
stable last. `w:pPrChange`, `w:sectPrChange`, move elements, and other revision
elements are irrelevant unless they contain a misplaced `w:ins`/`w:del`.
Content revisions in other paragraphs remain irrelevant. Terminal body
`w:sectPr` remains stable.

This is deliberately narrower than WordprocessingML generally; the certificate
describes the implemented subset and fails closed outside it.

### 2. Two projections, no correspondence heuristic

Each compared section retains `comparedSectionOrdinal`. A stable section
increments both source ordinals. An inserted section increments only revised.
The original projection therefore has no ordinal for that section. Projected
counts and ordered direct slots must exactly equal their respective source
inventory before any relationship resolution begins.

### 3. Protocol v8 succeeds the pending comment-range protocol v7

`verify-lean-comment-range-topology` already owns protocol v7 and its exact
16-field grammar. This change is implemented only after that change is
complete and archived. V8 preserves its top-level grammar, range topology,
issue/envelope semantics, and public-v1 behavior. It changes only the nested
relationship, selection, source-partition, checker identity, and version
surfaces named by this change.

### 4. Protocol v8 makes absence and work first-class

The exact slot side union is:

```ts
type SlotSide =
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

The exact physical-story side union includes the work needed to validate the
absence/presence claim:

```ts
type StorySide =
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

Only inserted/original may be absent. Revised and compared are always present
in this increment. Public and internal evidence share these union equations;
the launcher revalidates rather than trusting the executable.

### 5. Absent means no work; present means accounted work

An absent slot side performs zero relationship resolution. Each present logical
slot side resolves exactly once before deduplication. An absent physical-story
side contributes `[]` to the generic story triple and exactly zero tokens; it
is excluded from extraction, ZIP-byte, parse-event, selected-part, and
evidence-path work. A present physical-story side must complete every physical
step and contributes its actual measures. Deduplication occurs only after exact
three-side presence/path identity is known.

Aggregate equations sum each admitted present deduplicated physical work item
once plus the inherited fixed overhead. Per-side and three-package compressed,
expanded, selected-part, and XML-event caps are fixed in the normative delta.
Lean binds both slot-resolution and physical-story records to actual request
evidence and enforces the inherited whole-request equations. Because the
unchanged v7 16-field response does not expose every main/fixed/note/comment
measurement, TypeScript rechecks only the exact exposed slot/story schema,
equations, arithmetic, and per-part caps; it does not claim to recompute
unobservable whole-request sums.

### 6. Note and comment source partitions are distinct bijections

For side `s`, derive:

```text
expectedSources(s) =
  [main] ++
  relationshipStories.filter(story => story.side(s).present)
```

The filter preserves ascending global `physicalStoryOrdinal`; the array index
is `sourceOrdinal`. Every present physical story occurs exactly once, retains
its global ordinal/kind/path, and every absent story occurs zero times.
This is the note-reference partition. The comment source set is that complete
partition followed by present footnotes and then present endnotes. Comments
definition content is not a reference source. Resolution, extraction, parse,
identity, resource, or either bijection failure sets that side's partition to
incomplete and comment topology to not evaluated. A proven absence does not.

### 7. Modify one canonical contract and layer successor requirements

The delta reproduces the complete canonical relationship-alignment requirement
under its exact heading and modifies it. Protocol, public-certificate, source,
work, and evidence rules are additive successor requirements, preserving the
canonical protocol-v4 guarantees and the pending v5-v7 changes rather than
replacing their blocks.

The production acceptor remains
`packages/docx-compare/src/baselines/atomizer/trackChangesAcceptorAst.ts`.
Tests use that same accept/reject implementation; no verifier-local projection
is accepted as evidence of production exactness.

### 8. Redistributable real-DOCX provenance and transformation

The existing fixture
`tests/test_documents/open-agreements/common-paper-mutual-nda.docx` has
SHA-256
`9a61c5b6acee7248df24ddd157c039fc6918230aee8ccbd2627cd6f7c4d9a492`.
It is based on Common Paper's Mutual NDA, whose source repository is public
under CC BY 4.0. Implementation first adds adjacent machine-readable
provenance: version, official URL, hash, CC BY 4.0, derivative/redistribution
permission, derivative status, and attribution. No restricted NVCA binary is
used for this new gate.

A focused integration test gains a deterministic helper that clones the
package and adds the revised section paragraph, direct explicit footer
binding, relationship record, content-type coverage, and footer part. The
production comparator—not the helper—must create the tracked compared shape.

### 9. Proof obligations

The implementation SHALL prove or audit:

- classifier exclusivity and lifecycle issue-or-classification completeness;
- accept/reject projected ordinal contiguity and source correspondence;
- slot issue-or-alignment completeness;
- slot-to-physical-story bijection and exact presence/path keying;
- absent-zero-work/zero-token and present-work accounting equations;
- note-partition and comment-source-set bijections;
- present/absent work and side/triple resource equations;
- aggregate success implies all generic checks for all present physical work;
- protocol serialization/refinement into the strict TypeScript bridge.

All new theorem targets enter `AxiomAudit.lean`; the repository's exact
six-name axiom allowlist and zero-`sorry` requirement remain unchanged.

## Risks / Trade-offs

- The classifier intentionally rejects valid but unsupported Word shapes. This
  is preferable to a false certificate and creates a precise future subset
  extension point.
- Protocol work is larger than suppressing one diagnostic, but explicit
  presence and accounting prevent unverifiable empty-story shortcuts.
- Deletion remains a known gap until #754 changes production output; this
  proposal does not disguise that asymmetry.

## Migration and rollback

After protocol v7 is archived, implement classifier/projections, then v8
evidence and strict decoding, then work/accounting and partitions, then proof
and real-DOCX gates. Protocol v6 remains readable only as historical public
metadata; v8 becomes the current producer. Rollback restores the v7 producer,
preserving v7 comment topology while reinstating raw section-count fail-closed
behavior. No stored-document migration is required.

## Open questions

None. This increment is insertion-only and protocol-v8 by design.
