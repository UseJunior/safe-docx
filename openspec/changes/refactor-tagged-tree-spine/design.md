## Context

The tagged tree introduced by the predecessor change preserves both side
representatives and makes accept/reject projections structural folds. Publication
is not independent, however: a full legacy comparison still creates the result
archive, selects the base side, imports package parts, reconciles footnotes, and
produces most statistics before `word/document.xml` is replaced with tagged XML.

This migration removes roughly 9,700 non-test and 10,000 test lines, so deletion
cannot precede characterization. Legacy equality is not a correctness oracle; the
legacy implementation has known fuzzy-move and numbering defects. Evidence is
therefore split into projection invariants, package/OOXML invariants, and explicit
legacy characterization with adjudicated divergence identifiers.

## Goals / Non-Goals

### Goals

- Make the tagged tree the only comparison and package-publication spine.
- Port reusable OOXML knowledge instead of recreating it.
- Preserve public statistics only where their observable meaning is preserved.
- Make every retained option observable on the tagged path.
- Remove the legacy implementation without losing regression evidence.

### Non-Goals

- Adding a text-diff dependency or adopting `diff-match-patch`.
- Changing story-isolation semantics through `composeTaggedStories`.
- Removing safety, formatting-fidelity, or text-box revision checks.
- Treating equality with a known-defective legacy result as proof of correctness.
- Collapsing the authority flip, public break, and deletion into one release.

## Decisions

### Differential evidence precedes every behavior change

The first production-independent artifact is a committed manifest over the real
corpus, ILPA pair, and synthetic capability fixtures. Each row records fixture
identity and hash, capability tags, both source projections, normalized package
part summaries, statistics, fallback diagnostics, unrepresented changes, schema
results, relationship/auxiliary closure, and approved divergence IDs.

Corpus absence, a disappearing entry or package part, fallback, and unreviewed
divergence drift are failures. Fixes first appear as known divergences and only
then flip green, so their pre-fix behavior remains reviewable.

### One revision-ID allocator serves tagged publication

Consumer compatibility can split revision wrappers while hoisting bookmarks.
Tagged publication parses the complete tagged document, seeds one canonical
revision allocator from every surviving numeric revision `w:id`, invokes
`enforceConsumerCompatibility(root, allocator, { repairBookmarkInventory: false })`,
serializes, suppresses volatile PAGEREF cache revisions, and applies safety and
formatting gates to those final bytes. Bookmark IDs are a separate namespace and
never seed this allocator.

### Rationale provenance lives on tagged nodes

Markdoc rationale attribution uses existing `revisionProvenance` on the tagged
tree. A compilation operation maps to exactly one bounded emitted range, with no
overlap, ambiguity, sentinel leakage, or rationale text in any ZIP part. Dense
rewrites remain stable without a word-refinement budget. The legacy Markdoc pin
is removed only after internal and external rationale modes pass real-document
evidence.

### Move detection uses exact matching, then deterministic global fuzzy matching

Exact subtree-signature matching remains first to preserve the equal-content
invariant. Residual candidates use extracted `jaccardWordSimilarity` and
`wordContainmentSimilarity`, deterministic ordering/tie-breaking, and one-to-one
global matching. Candidates exclude paired paragraph representatives, conflicting
ancestor/descendant subtrees, overlaps, fields/ranges that cannot be safely moved,
and preserved input moves. Repeated content must yield stable names and IDs.

### Every option has an observable or an explicit removal

The option matrix covers `moveSimilarityThreshold`, case-insensitive move matching,
minimum word count, word refinement, premerge normalization, numbering
virtualization, hyperlink destination identity, direct versus paragraph-style
properties, fields, opaque payload, preserved revision provenance, and effective
styles. Each has a tagged call path plus tagged-specific test or appears in the
spec-visible removal inventory.

### Standalone publication starts from the revised archive

The assembler receives original/revised packages and tagged publications, never
legacy `resultBuffer`, `mergedAtoms`, or `comparisonResult.outputMode`. It owns
relationship/content-type closure; headers, footers, notes, comments, people,
numbering, styles, media and custom XML; auxiliary-ID collisions; footnote
reconciliation; text-box and ancillary stories; unrepresented changes; and final
safety/fidelity gates. Shadow comparison covers package manifests and normalized
parts, not only main-story projections.

Text-box re-homing replaces reconstruction-mode guards with per-story tagged
publication checks while preserving `UnsupportedTextBoxRevisionError` and the
implementation in `textBoxRevisionSafety.ts`.

### Stats come from final tagged markup

Range counts are derived from final serialized markup because serialization can
coalesce or split wrappers around refinement, bookmarks, fields, properties,
opaque subtrees, whole-paragraph/row revisions, and existing provenance.
Modified paragraphs are keyed by `TaggedNode`, not either representative.
Paragraph-style deltas count once.

`insertedAtoms`, `deletedAtoms`, and `formatChangeAtoms` retain their names only
if an explicit tagged atomization reproduces their legacy contract. Otherwise
they are renamed/versioned in the breaking release and the spec documents the
new meaning. Silent token-weighting changes are forbidden.

Footnotes use `buildTaggedTreePublication` for wrapped definition pairs.
Property naming moves to a portable `propertyNaming.ts` before legacy format
detection is deleted.

### Authority, compatibility, and deletion are separate releases

The standalone tagged assembler first runs in shadow, then becomes authoritative
with a private emergency switch. At least one release/corpus cycle must show the
characterization manifest stable before public options are removed. The public
break ships separately. Legacy deletion occurs only after the soak gate; the last
legacy-capable commit is tagged and a maintenance branch retained with a written
multi-commit rollback procedure.

Before deletion, portable revision helpers move to `revisionMarkup.ts`:
`formatDate`, `RevisionIdState`, allocator creation/seeding/allocation,
`wrapRunWithTrackChange`, and `addParagraphMarkRevisionMarker`. This keeps
`textBoxRevisionSafety.ts` independent of deleted `inPlaceModifier*` modules.

### Portable keepers retain their implementation

The migration reuses `fieldComparisonSemantics.ts`, `trackChangesAcceptorAst.ts`,
`textBoxRevisionSafety.ts`, `formattingFidelity.ts`, `auxiliaryIdCollision.ts`,
`relationshipIdCollision.ts`, `consumerCompatibility.ts`,
`markupCompatibility.ts`, `ancillaryFieldSafety.ts`, `tocPagerefCache.ts`,
`xmlToWmlElement.ts`, `unrepresentedChanges.ts`, and `textAlignment.ts`.
Dependencies of each keeper are inventoried before deletion. `premergeRuns.ts`
is retained only if the option matrix establishes tagged observability.

## Risks / Trade-offs

- A differential can be falsely green while both paths share the legacy package
  assembler; independent shadow assembly is mandatory before authority flips.
- Tagged safety failure becomes an exception after fallback deletion. A typed
  `TaggedPublicationSafetyError` retains all existing diagnostics.
- Auxiliary sidecar checks are currently inert and formatting fidelity is outside
  the safety gate; both become load-bearing before the flip.
- Deleting implementation and its only tests can conceal lost behavior; the
  capability manifest must own every retained behavior first.
- Public package provenance changes from mode-dependent to revised-based.
- Coverage, Allure filename, ECMA citation, generated spec, tool-doc, MCPB, and
  capability-projection ratchets all require deliberate re-baselining.

## Migration Plan

1. Archive the predecessor and establish differential evidence.
2. Remove only proven-dead code and publish an API-removal inventory.
3. Port correctness, Markdoc provenance, options, moves, package assembly, and
   stats while legacy remains authoritative.
4. Flip authority behind an internal switch and soak for one release/corpus cycle.
5. Remove public options in a dedicated breaking release.
6. Tag the rollback point, extract keepers, delete legacy, regenerate evidence,
   and document the exact rollback sequence.
7. Rename surviving tagged modules after the rollback window.

Rollback before deletion selects the private legacy switch. Rollback after
deletion follows the documented multi-commit sequence from the maintenance tag;
it is not represented as a one-commit revert.

## Open Questions

- The API-removal inventory decides compatibility shims versus deprecation for
  each wildcard-exported symbol before Phase 2 ships.
- The stats phase must choose exact legacy atom semantics or renamed/versioned
  metrics based on differential evidence; it may not claim both.
- `premergeRuns` survives only if a tagged observable is justified and tested.
