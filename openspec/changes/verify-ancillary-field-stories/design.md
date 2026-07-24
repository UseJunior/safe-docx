## Context

`evaluateSafetyChecks` currently applies the Lean-pinned
`validateFieldStructure` predicate to `word/document.xml` and footnote/endnote
entries extracted from both input sidecars. That runs before reconstruction
mode selection and before auxiliary definitions are merged into the result.
Header/footer parts are excluded because selecting them requires section-binding
and relationship resolution.

The final package is mode-dependent. True inplace output clones the revised
archive and imports still-referenced definitions from the original; forced
rebuild and inplace fallback clone the original archive and import definitions
from the revised. Before either assembly, auxiliary ID collision handling may
mutate the revised in-memory archive and renumber definitions and references.
Final ancillary validation and preservation evidence must therefore use those
post-collision in-memory archives and the actual merge results, not the original
input buffers or a reconstructed guess at provenance.

## Goals / Non-Goals

- Goals: reuse or extract the existing `sectPrAudit` binding contract to select
  every valid section-bound header/footer and retain all binding locators.
- Goals: validate every selected header/footer and every final
  footnote/endnote entry with a strict runtime field predicate and fresh state.
- Goals: reject duplicate direct note-entry IDs before locator/provenance
  construction.
- Goals: enumerate eligible source fields first and require exact final
  inventory equality by deterministic structural locator and canonical range.
- Goals: retain entry-level provenance across base wins, imports, created note
  parts, reserved-entry copies, same-ID identical definitions, and collision
  renumbering.
- Goals: expose successful preservation evidence and structured typed-error
  diagnostics with story locator, failure category, issue codes, and details.
- Goals: add optional success evidence and ancillary fallback diagnostics to
  `CompareResult` without changing existing result field meanings.
- Goals: cover forced rebuild, true inplace, ancillary-triggered inplace
  fallback, terminal failure, and a minimally edited pair derived from the
  checked-in NVCA COI source document.
- Non-Goals: selecting headers/footers by filename, validating unreferenced
  header/footer parts, or predicting first/default/even pagination behavior.
- Non-Goals: comparing ancillary text, synthesizing ancillary revisions,
  evaluating fields, computing pagination or cached results, or resolving REF
  and PAGEREF bookmarks.
- Non-Goals: complete footnote/endnote definition/reference integrity,
  relationship validation for note parts, or a claim that every note definition
  is reachable.
- Non-Goals: changing the Lean checker, executable protocol v3, its
  inplace-only mode, or its fixed main/footnotes/endnotes scope.

## Decisions

### Selection reuses the section-binding audit contract

The implementation reuses or extracts the binding-resolution portion of
`auditSectPr` instead of creating a looser relationship walker. A selected valid
section binding must be a direct `w:headerReference` or `w:footerReference`
child of a structurally valid `w:sectPr`; carry a `w:type` role of `default`,
`first`, or `even`; be unique by kind and role within that section; carry an
unambiguous `r:id`; resolve through exactly one final
`word/_rels/document.xml.rels` relationship of the matching header/footer type;
use an internal package-contained safe target; and point to a part with the
expected `w:hdr` or `w:ftr` root.

The resolver and opaque passthrough use one docx-core OPC target helper. It
rejects empty, query/fragment-bearing, control-bearing, encoded traversal or
separator, backslash, scheme-like, network-path, and package-escaping internal
targets. Missing `TargetMode` and exact `Internal` are internal; exact
`External` is rejected for section bindings, and any other value is invalid.

Each binding receives a locator consisting of depth-first section ordinal,
`header` or `footer` kind, and role. Multiple valid bindings may reuse one
normalized target. Target XML and strict field validation are deduplicated by
normalized part path, but diagnostics and successful evidence retain every
binding locator that selected that target.

The selector never enumerates `word/header*.xml` or `word/footer*.xml`.
Malformed unreferenced parts therefore remain outside validation. Invalid
section bindings, duplicate relationship IDs, missing relationships, wrong or
external relationship types, unsafe targets, missing parts, malformed XML, or
wrong roots are binding-resolution failures.

Target normalization and package containment are explicit SafeDocX safety
policies. They are not attributed to ECMA-376.

### Strict ancillary field validation is separate from Lean

A new strict ancillary predicate is independent of the Lean-pinned
`validateFieldStructure`. It may reuse `collectFieldStructureIssues`, but its
per-story stack additionally rejects:

- an `end` marker when no field is open;
- a `separate` marker when no field is open;
- a second `separate` marker at the same open-field depth;
- any missing or unknown `w:fldCharType`; and
- nonzero field depth at the end of the story.

The stack tracks separator state per depth. A complete begin/end-only field is
valid because `separate` is optional for this structural predicate. Properly
stacked nested fields are valid. Every selected header/footer part and every
direct `w:footnote` and `w:endnote` entry, including reserved entries, starts
with fresh state. This note-entry isolation is a SafeDocX safety policy, not a
new ECMA note claim.

A `separate` marker encountered at depth zero is rejected independently as
`FIELD_STRAY_SEPARATOR`. It is not folded into duplicate-separator or
instruction-text diagnostics.

Before strict entry validation, provenance mapping, or evidence inventory, each
final note part and its base contributor is scanned namespace-aware. A
merge-source part is scanned only when merge results show imported definitions
or a newly created final part. An unused merge-source part is not parsed and
cannot poison the selected package. Direct `w:footnote/@w:id` and
`w:endnote/@w:id` values are whitespace-collapsed, validated against the
`xsd:integer` lexical form, and canonicalized to their integer value before
duplicate detection or mapping. Thus `1`, `01`, and `+1` collide, while valid
negative reserved IDs remain valid. Invalid lexical forms use
`INVALID_NOTE_ENTRY_ID`; numeric duplicates use `DUPLICATE_NOTE_ENTRY_ID` in
the `canonical_evidence` category. The locator uses the archive side when
applicable, note part path, and canonical entry ID, not an entry ordinal. This
is an explicit SafeDocX evidence-safety policy needed for unambiguous locators;
it does not claim complete note integrity.

Tests pin examples where the strict predicate intentionally differs from
`validateFieldStructure`, while the production Lean predicate, differential
harness, executable protocol v3, and certificate remain unchanged.

### Failure handling is deterministic and terminal

The post-assembly gate has three failure categories:

- `binding_resolution`;
- `strict_field_structure`; and
- `canonical_evidence`.

Each issue has a stable code, human-readable detail, and a structured story
locator. Header/footer locators carry section ordinal, kind, role, and normalized
part path when resolution reached one. Note locators carry normalized part path
and entry ID. Canonical evidence locators additionally carry paragraph ordinal,
eligible field ordinal, and instruction kind.

The error contract uses discriminated data rather than parsing messages:

- `AncillaryBindingLocator` carries `locatorType: "section_binding"`,
  `sectionOrdinal`, `kind`, `role`, and optional `normalizedPartPath`;
- `AncillaryHeaderFooterStoryLocator` carries
  `locatorType: "header_footer_story"`, `normalizedPartPath`, and all selecting
  binding locators;
- `AncillaryNoteStoryLocator` carries `locatorType: "note_entry"`,
  `normalizedPartPath`, and `entryId`; and
- canonical issues extend the header/footer or note locator with
  `paragraphOrdinal`, `eligibleFieldOrdinal`, and `instructionKind`.

`AncillaryStorySafetyIssue` carries `category`, `code`, `detail`, and one of
those locators. Binding codes reuse the applicable `SectPrIssueType` values.
Strict-only codes include `FIELD_STRAY_END`, `FIELD_STRAY_SEPARATOR`,
`FIELD_DUPLICATE_SEPARATOR`, `FIELD_UNKNOWN_CHAR_TYPE`, and
`FIELD_UNCLOSED_DEPTH`, alongside reused field issue codes. Evidence codes
include `DUPLICATE_NOTE_ENTRY_ID` and distinguish `FIELD_RANGE_MISSING`,
`INVALID_NOTE_ENTRY_ID`, `FIELD_RANGE_EXTRA`, `FIELD_RANGE_KIND_MISMATCH`, and
`FIELD_RANGE_CANONICAL_MISMATCH`.
`AncillaryStorySafetyError` exposes a non-empty ordered `issues` array.

Any category failure rejects an inplace candidate and triggers exactly one
rebuild assembly. Selection, strict validation, provenance, and evidence are
recomputed against that rebuilt package. Any category failure on forced/direct
rebuild, or on the terminal rebuild after inplace rejection, throws
`AncillaryStorySafetyError` before serialization is returned or published. The
error exposes all structured issues. A failed call returns no `CompareResult`
and therefore no public preservation evidence. There is no warning-only success
path for these failures.

### Preservation inventory is source-first and locator-based

For each source story selected for assembly, the implementation enumerates
eligible ranges in deterministic depth-first document order. Eligibility
requires a complete, non-nested complex field wholly contained in one paragraph
whose instruction is accepted by the same PAGE/NUMPAGES/REF/PAGEREF parser and
switch rules introduced by PR #617. Header/footer inventories retain only PAGE
and NUMPAGES; note-entry inventories retain only REF and PAGEREF.

Each source item has a stable structural identity composed of:

- normalized package part path;
- note entry ID for note stories;
- paragraph ordinal within the header/footer story or note entry;
- eligible-field ordinal within that paragraph.

Instruction kind remains reported on the locator and evidence item but is not
part of structural identity. This makes a PAGE-to-NUMPAGES change at the same
source-first ordinal a reachable `FIELD_RANGE_KIND_MISMATCH`.

The final package is independently inventoried by the same algorithm. Source
and final structural locators and canonical ranges must match exactly. Missing,
extra, relocated, reclassified, or canonically mismatched ranges are failures.
Ordering is represented by paragraph and eligible-field ordinals rather than a
separate order diagnostic. Repeated canonically identical fields remain
distinct because locators, not hashes, establish identity.

Nested and cross-paragraph fields are excluded from exact preservation
inventory, but the complete containing story still must pass strict field
validation. Exclusion from inventory is not a passing preservation claim.

### Canonical ranges reuse PR #617 expanded-name canonicalization

The implementation extracts and reuses the PR #617 canonical subtree algorithm
instead of defining a second representation. A range is the ordered direct
paragraph-child span from the child containing `fldChar begin` through the child
containing its matching `fldChar end`. Canonicalization ignores namespace
declaration spelling/order and ordinary attribute order. It retains expanded
element and attribute names, attribute values, text, child order, run
boundaries, wrappers, and all other represented subtree structure.

Exact canonical equality is a SafeDocX metamorphic invariant. It is not package
byte identity and is not an ECMA-376 preservation requirement.

### Provenance follows post-collision assembly inputs

Provenance is captured from the post-collision in-memory base and merge-source
archives actually consumed by assembly:

- an entry ID already present in the base is base-provenance and wins;
- an ID returned by auxiliary merge as imported is merge-source provenance;
- when a note part is newly created, copied reserved entries are merge-source
  provenance and imported referenced entries retain merge-source provenance;
- same-ID content-identical definitions are not renumbered, so the base entry
  wins and receives base provenance; and
- content-different collisions use the revised-side post-renumber ID and source
  entry, so evidence locators and provenance reflect the rewritten in-memory
  archive rather than the pre-collision ID.

Provenance is defined for every final note entry even though exact evidence
inventories only eligible REF/PAGEREF ranges. This avoids inferring source from
final XML after merge and makes created-part reserved-entry ownership explicit.

### Successful result and fallback fields are additive

Successful atomizer results may include this optional contract:

```ts
interface AncillaryFieldEvidence {
  status: 'passed';
  reconstructionMode: ReconstructionMode;
  selectedBindings: AncillarySelectedBindingSummary[];
  stories: AncillaryStorySummary[];
  ranges: AncillaryFieldRangeEvidence[];
}

interface AncillarySelectedBindingSummary {
  sectionOrdinal: number;
  kind: 'header' | 'footer';
  role: 'default' | 'first' | 'even';
  relationshipId: string;
  normalizedPartPath: string;
}

interface AncillaryStorySummary {
  storyKind: 'header' | 'footer' | 'footnote' | 'endnote';
  normalizedPartPath: string;
  entryId?: string;
  selectingBindings?: AncillaryBindingLocator[];
  sourceSide?: 'original' | 'revised';
  provenance?: 'base' | 'imported';
  strictFieldStructure: 'passed';
}

interface AncillaryFieldRangeEvidence {
  locator: AncillaryFieldLocator;
  instructionKind: 'PAGE' | 'NUMPAGES' | 'REF' | 'PAGEREF';
  sourceSide: 'original' | 'revised';
  provenance: 'base' | 'imported';
  canonicalMatch: true;
}

interface AncillaryFallbackDiagnostics {
  issues: AncillaryStorySafetyIssue[];
}
```

`CompareResult.ancillaryFieldEvidence?: AncillaryFieldEvidence` is optional at
the type level for compatibility, but an atomizer comparison that reaches and
passes this gate returns it. Its `reconstructionMode` always equals
`reconstructionModeUsed`. `stories` summarizes each deduplicated header/footer
target and note entry. Every `ranges` item carries the stable structural locator
already defined above; `instructionKind` is repeated as a convenient
discriminator.

`ReconstructionFallbackReason` gains
`ancillary_story_safety_check_failed`. When ancillary failure rejects an
inplace candidate and rebuild succeeds, `fallbackReason` has that value and
`CompareResult.ancillaryFallbackDiagnostics?: AncillaryFallbackDiagnostics`
contains the rejected candidate's ordered structured ancillary issues. The
successful `ancillaryFieldEvidence` is newly computed from the final rebuild,
identifies `rebuild`, and contains no rejected-candidate evidence.

These fields are additive and optional for compatibility with prior producers,
other comparison engines, and results where the capability is unavailable.
Consumers treat absence as unavailable evidence, never as a pass. Terminal
failure throws and returns no `CompareResult`, so there is no failed
`AncillaryFieldEvidence` status.

### NVCA evidence uses one real source-derived pair

The real-document test loads
`tests/test_documents/nvca-coi-regression/source.docx`, clones it, and uses the
exported `replaceParagraphTextRange` primitive to make one minimal body-text
edit outside the ancillary fields being inventoried. It does not use
`filled.docx` as the revised side. The same real source-derived pair runs
through requested inplace and forced rebuild. The inplace run must remain true
inplace; both runs must report final-mode evidence with at least one selected
footer PAGE range and at least one footnote REF range, including exact canonical
matches and concrete provenance.

### Conformance claims remain bounded

ECMA-376 edition 5 Part 1 §§17.10.2 and 17.10.5 cover the registered typed
footer/header binding surface; §§17.10.3 and 17.10.4 cover the expected story
roots. Section 17.16.18 covers complex-field structure, and §§17.16.5.42,
17.16.5.44, 17.16.5.45, and 17.16.5.51 cover the bounded instruction
vocabulary.

Target normalization, package containment, note-entry isolation, provenance,
duplicate direct note-ID rejection, and exact canonical preservation are
SafeDocX policies or invariants, not ECMA claims. This change adds no unsupported
Part 2 or note clauses. Section
17.11.14 is cited only by implementation or tests that actually exercise
`w:footnoteReference/@w:id` as a reference identifier; independent note-entry
validation or REF/PAGEREF preservation does not justify that citation.

### Lean remains a fixed-story certificate

The Lean certificate remains executable protocol v3, public certificate
protocol v1, inplace-only, and fixed to `word/document.xml`,
`word/footnotes.xml`, and `word/endnotes.xml`. Strict runtime ancillary
validation and preservation diagnostics do not become Lean evidence.
Dynamically relationship-addressed header/footer stories require a separate
protocol and proof-model change and are the next separate slice.

## Risks / Trade-offs

- A post-assembly failure may cause a second full assembly. The one-rebuild
  limit gives deterministic cost and behavior.
- Strict runtime validation intentionally rejects malformed shapes tolerated by
  the Lean-pinned predicate. Keeping separate APIs and differential tests avoids
  silently changing an established proof boundary.
- Locator equality treats paragraph or eligible-field reordering as a
  preservation failure even when canonical ranges are identical. This is
  required to make repeated fields non-ambiguous.
- Canonical DOM equality is stricter than semantic field equivalence but weaker
  than ZIP-byte equality. It matches the established PR #617 invariant.
- Relationship resolution deliberately rejects ambiguous targets rather than
  guessing filenames, so some malformed third-party packages fail closed.

## Migration Plan

Successful results gain optional additive ancillary evidence. The fallback
reason union and result gain an ancillary reason and optional rejected-candidate
diagnostics. Existing fields, comparison options, and Lean certificate fields
do not change meaning. Calls that would previously return a package with
malformed selected ancillary stories, duplicate direct note IDs, or mismatched
eligible ranges now either recover through one rebuild or throw
`AncillaryStorySafetyError`; callers can inspect its structured issues.
Unreferenced malformed header/footer files remain ignored.
