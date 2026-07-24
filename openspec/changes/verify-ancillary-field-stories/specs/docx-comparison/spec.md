## ADDED Requirements

### Requirement: Final packages verify selected valid section-bound field stories

After complete reconstruction-mode-specific package assembly, the system SHALL
validate every header/footer part selected by a valid section binding and every
final footnote/endnote entry as an independent strict field story. Selection
SHALL reuse or extract the `sectPrAudit` binding contract: a reference must be a
direct child of a valid `w:sectPr`, have a valid and per-section unique
default/first/even role, carry an unambiguous `r:id`, resolve through the exact
matching internal relationship type to a safe package-contained target, and
point to the expected `w:hdr` or `w:ftr` root.

The shared OPC target normalizer SHALL reject empty targets, query/fragment or
control characters, encoded traversal or separators, backslashes, scheme-like
or network-path forms, and package-root escape. An absent `TargetMode` or exact
`Internal` SHALL be internal. Exact `External` SHALL be rejected for selected
headers/footers, and every other `TargetMode` value SHALL be invalid.

Target validation SHALL be deduplicated by normalized part path while retaining
every selecting binding locator as section ordinal, kind, and role. The system
SHALL NOT select header/footer stories by filename glob, and an unreferenced
malformed header/footer part SHALL NOT affect the safety result.

#### Scenario: [SDX-ANC-STORY-01] Valid section bindings select header and footer targets

- **GIVEN** final section properties containing direct header/footer references and the package also containing unreferenced header/footer filenames
- **WHEN** the final ancillary story set is selected
- **THEN** every selected binding SHALL have a valid role, unique kind/role within its section, unambiguous relationship ID, exact relationship type, safe internal target, and expected root
- **AND** indirect reference placement, invalid target modes, external targets, and unsafe internal target forms SHALL fail with binding-resolution diagnostics
- **AND** each binding locator SHALL retain section ordinal, kind, and role
- **AND** no filename glob SHALL add an unreferenced part

#### Scenario: [SDX-ANC-STORY-02] Reused targets validate once but retain all bindings

- **GIVEN** multiple valid section bindings that resolve to the same normalized header or footer target
- **WHEN** final ancillary validation runs
- **THEN** the target story SHALL be parsed and strictly validated once
- **AND** diagnostics and evidence SHALL retain every binding locator that selected it

#### Scenario: [SDX-ANC-STORY-03] Every selected story has independent field state

- **GIVEN** selected headers, selected footers, and final footnote/endnote parts with multiple entries
- **WHEN** final-package field validation runs
- **THEN** every deduplicated selected header/footer target SHALL start with fresh field state
- **AND** every direct footnote/endnote entry, including reserved entries, SHALL start with fresh field state
- **AND** field markers in one story SHALL NOT balance markers in another

#### Scenario: [SDX-ANC-STORY-04] Invalid selected bindings fail and unreferenced malformed parts do not

- **WHEN** a section binding violates placement, role, uniqueness, relationship-ID, relationship-type, target-safety, part-presence, XML, or expected-root requirements
- **THEN** the assembled candidate SHALL fail with a structured binding-resolution issue
- **AND** a malformed header/footer part with no valid selecting section binding SHALL not be parsed, trigger failure, or receive passing evidence

### Requirement: Strict ancillary field validation is separate from the Lean-pinned predicate

The system SHALL provide a strict ancillary field-story predicate without
changing the Lean-pinned `validateFieldStructure` predicate. The strict
predicate MAY reuse existing field issues and SHALL additionally reject a stray
end marker, a `separate` marker at depth zero, a duplicate separator at the same
open-field depth, a missing or unknown `w:fldCharType`, and unclosed field depth
at story end. Separator state SHALL be tracked independently at each nested
depth. A depth-zero separator SHALL report the distinct issue code
`FIELD_STRAY_SEPARATOR`.

A properly stacked nested field SHALL pass strict structural validation. A
begin/end-only field SHALL pass because a separator is optional for this
predicate. The Lean predicate, differential harness, checker protocol, and
certificate semantics SHALL remain unchanged.

#### Scenario: [SDX-ANC-STRICT-01] Strict-only malformed shapes are rejected

- **WHEN** one ancillary story contains a stray end, stray depth-zero separator, duplicate same-depth separator, unknown or missing `fldCharType`, or unclosed field depth
- **THEN** the strict predicate SHALL return a stable issue code and story locator for that defect
- **AND** a depth-zero separator SHALL report `FIELD_STRAY_SEPARATOR`
- **AND** tests SHALL explicitly record any case intentionally tolerated by `validateFieldStructure`

#### Scenario: [SDX-ANC-STRICT-02] Valid optional separators and nested stacks pass

- **GIVEN** one begin/end-only field and one properly stacked nested field with separator state isolated per depth
- **WHEN** strict ancillary validation runs
- **THEN** both stories SHALL pass
- **AND** nested markers SHALL close in last-opened-first-closed order

#### Scenario: [SDX-ANC-STRICT-03] Lean behavior does not change

- **WHEN** the strict ancillary predicate is introduced
- **THEN** `validateFieldStructure` and its Lean differential expectations SHALL remain unchanged
- **AND** executable checker protocol v3 and the existing certificate SHALL remain unchanged

### Requirement: Ancillary field preservation evidence is source-first and provenance-aware

Before provenance mapping or evidence inventory, the system SHALL validate
each final note part and its base contributor. It SHALL validate a
post-collision merge-source note part only when merge results show that it
supplied imported definitions or a newly created final part. An unused
merge-source defect SHALL not reject. Direct `w:footnote/@w:id` and
`w:endnote/@w:id` values SHALL be canonicalized as `xsd:integer` values before
duplicate detection and mapping. Invalid lexical forms SHALL fail with
`INVALID_NOTE_ENTRY_ID`; numerically equivalent values such as `1`, `01`, and
`+1` SHALL fail with `DUPLICATE_NOTE_ENTRY_ID`, source side when applicable,
normalized part path, and canonical duplicated ID rather than an invented
entry ordinal. Valid negative reserved IDs SHALL remain valid. This is an
evidence-safety policy for unambiguous locators and SHALL NOT imply complete
note integrity.

The system SHALL inventory eligible source fields before inspecting the final
package. Eligible fields are complete, non-nested, self-contained within one
paragraph, and accepted by the same supported instruction parser as PR #617.
Selected header/footer inventories SHALL include PAGE and NUMPAGES; note-entry
inventories SHALL include REF and PAGEREF.

Source fields SHALL be enumerated in deterministic depth-first order and
located by normalized part path, canonical note entry ID when applicable,
paragraph ordinal within the story or entry, and eligible-field ordinal within
that paragraph. Instruction kind SHALL remain reported but SHALL not be part of
structural locator identity. The final package SHALL be independently
inventoried by the same algorithm. Missing, extra, relocated, reclassified, or
canonically mismatched ranges SHALL fail. Reordering is represented by the
structural ordinals rather than a separate order diagnostic. Repeated identical
fields SHALL be distinguished by locator rather than hash.

Each eligible range SHALL use the extracted PR #617 expanded-name canonical
subtree algorithm. Namespace declaration spelling/order and ordinary attribute
order SHALL be ignored; expanded names, attribute values, text, child order,
run boundaries, wrappers, and represented subtree structure SHALL be retained.
Nested and cross-paragraph fields SHALL be excluded from exact-preservation
inventory but SHALL remain subject to whole-story strict validation.

#### Scenario: [SDX-ANC-EVIDENCE-01] Selected header and footer source inventories match exactly

- **GIVEN** eligible PAGE and NUMPAGES fields in source parts selected by valid final section bindings
- **WHEN** forced rebuild or true inplace output is assembled
- **THEN** each source locator SHALL have exactly one corresponding final locator
- **AND** every corresponding complete canonical begin-through-end range SHALL match
- **AND** missing, extra, relocated, reclassified, or mismatched ranges SHALL fail with reachable distinct diagnostics

#### Scenario: [SDX-ANC-EVIDENCE-02] Duplicate direct note IDs are rejected before mapping

- **GIVEN** a base/final contributor or actually contributing post-collision merge source with invalid or numerically equivalent direct note IDs
- **WHEN** ancillary provenance and evidence preparation begins
- **THEN** invalid lexical IDs SHALL fail with `INVALID_NOTE_ENTRY_ID`
- **AND** numeric-equivalent duplicates SHALL fail with `DUPLICATE_NOTE_ENTRY_ID`, normalized part path, and canonical duplicated ID
- **AND** no entry ordinal SHALL be invented to disambiguate the duplicate
- **AND** the failure SHALL remain an evidence-safety policy rather than a complete note-integrity claim

#### Scenario: [SDX-ANC-EVIDENCE-06] Unused merge-source defects do not poison evidence

- **GIVEN** the final package and base contributor contain valid note entries and the opposite merge-source note part is malformed or has duplicate IDs
- **WHEN** merge results show that the opposite note part supplied no imported definitions and did not create the final part
- **THEN** ancillary evidence SHALL not parse or reject that unused merge-source part

#### Scenario: [SDX-ANC-EVIDENCE-03] Note evidence follows actual assembly provenance

- **GIVEN** eligible REF or PAGEREF fields in base-resident and imported note definitions
- **WHEN** auxiliary definitions are merged and final evidence is collected
- **THEN** existing base IDs SHALL use base provenance and imported IDs SHALL use merge-source provenance
- **AND** the source and final locator inventories and canonical ranges SHALL match exactly

#### Scenario: [SDX-ANC-EVIDENCE-04] Created parts and collision outcomes have defined provenance

- **GIVEN** a newly created note part, copied reserved entries, same-ID identical definitions, or content-different IDs renumbered before assembly
- **WHEN** provenance is recorded
- **THEN** copied reserved and imported entries in a created part SHALL identify the merge source
- **AND** a same-ID identical definition SHALL identify the base because the base entry wins
- **AND** a renumbered definition SHALL identify its post-collision source archive and rewritten entry ID

#### Scenario: [SDX-ANC-EVIDENCE-05] Repeated and excluded ranges are not confused

- **GIVEN** repeated canonically identical eligible fields plus nested or cross-paragraph fields
- **WHEN** source and final inventories are compared
- **THEN** repeated eligible fields SHALL remain distinct by structural locator
- **AND** nested and cross-paragraph ranges SHALL produce no exact-preservation evidence
- **AND** the containing stories SHALL still require strict validation

### Requirement: Ancillary safety failures rebuild once or throw before publication

The system SHALL classify post-assembly ancillary failures as
`binding_resolution`, `strict_field_structure`, or `canonical_evidence`.
Diagnostics SHALL include a stable issue code, detail, and structured story
locator. Field-evidence locators SHALL additionally identify paragraph ordinal,
eligible-field ordinal, and instruction kind.

Binding locators SHALL identify section ordinal, kind, role, and normalized
part path when available. Deduplicated header/footer story locators SHALL
identify their normalized path and all selecting bindings. Note-story locators
SHALL identify normalized part path and entry ID. Binding issue codes SHALL
reuse applicable section-audit codes; strict-only and evidence issue codes SHALL
distinguish the exact structural or inventory failure. The typed error SHALL
expose a non-empty ordered issue array without requiring callers to parse
messages.

Any ancillary failure SHALL reject an inplace candidate and trigger exactly one
rebuild assembly. Selection, strict validation, provenance, and evidence SHALL
be recomputed against the rebuilt package. Any ancillary failure on
forced/direct rebuild or on the terminal rebuilt fallback SHALL throw
`AncillaryStorySafetyError` before returning or publishing a document. A failed
call SHALL return neither a successful `CompareResult` nor public preservation
evidence.

`ReconstructionFallbackReason` SHALL add
`ancillary_story_safety_check_failed`. A successful rebuild caused by ancillary
inplace rejection SHALL use that reason and SHALL return optional
`ancillaryFallbackDiagnostics` containing the rejected candidate's ordered
structured ancillary issues. Those diagnostics SHALL NOT substitute for final
evidence.

#### Scenario: [SDX-ANC-FAIL-01] Ancillary failure itself triggers inplace fallback

- **GIVEN** an otherwise safe inplace candidate whose assembled ancillary package fails binding resolution, strict field validation, or canonical evidence
- **WHEN** comparison evaluates the candidate
- **THEN** that ancillary failure SHALL reject the inplace candidate and trigger one rebuilt assembly
- **AND** no preexisting main-story failure SHALL be required to cause fallback

#### Scenario: [SDX-ANC-FAIL-02] Successful fallback recomputes all ancillary evidence

- **GIVEN** ancillary failure rejects a revised-based inplace candidate and the original-based rebuild is valid
- **WHEN** the rebuilt package passes
- **THEN** comparison SHALL return the rebuilt document
- **AND** `fallbackReason` SHALL be `ancillary_story_safety_check_failed`
- **AND** `ancillaryFallbackDiagnostics` SHALL contain the rejected inplace candidate's structured issues
- **AND** selection, validation, provenance, and evidence SHALL describe only the rebuilt package
- **AND** no stale candidate evidence SHALL be returned

#### Scenario: [SDX-ANC-FAIL-03] Terminal ancillary failure throws a typed error

- **WHEN** direct/forced rebuild or the terminal rebuild fallback has any ancillary failure
- **THEN** comparison SHALL throw `AncillaryStorySafetyError` before returning or publishing document bytes
- **AND** the error SHALL expose a non-empty ordered array of structured category, locator, issue-code, and detail diagnostics
- **AND** no warning-only successful result or public evidence SHALL be returned

### Requirement: Successful ancillary evidence is an additive public result

`CompareResult` SHALL add the optional field
`ancillaryFieldEvidence?: AncillaryFieldEvidence`. A present value SHALL have
`status: "passed"`, the final `reconstructionMode`, selected binding and story
summaries, and range items. Each range item SHALL contain its stable locator,
instruction kind, source side (`original` or `revised`), provenance (`base` or
`imported`), and `canonicalMatch: true`.

The evidence reconstruction mode SHALL equal `reconstructionModeUsed`.
Successful fallback evidence SHALL be recomputed from the final rebuild and
SHALL identify `rebuild`. A terminal failure SHALL throw and return no
`CompareResult`; there SHALL be no failed evidence value. The new evidence,
fallback diagnostics, and fallback-reason member SHALL be additive and
compatible with prior consumers. Absence of either optional evidence or
diagnostics SHALL mean unavailable, not passing.

The field SHALL remain optional at the type level for compatibility. An
atomizer comparison that reaches and passes the ancillary gate SHALL populate
it. Selected binding summaries SHALL contain section ordinal, kind, role,
relationship ID, and normalized target. Story summaries SHALL contain story
kind, normalized path, strict-pass status, and selecting bindings or note entry
ID/source provenance as applicable.

#### Scenario: [SDX-ANC-RESULT-01] Successful true inplace evidence identifies the final package

- **WHEN** a true inplace package passes all ancillary checks
- **THEN** `ancillaryFieldEvidence.status` SHALL be `passed`
- **AND** its reconstruction mode SHALL be `inplace`
- **AND** its binding/story summaries and range items SHALL describe the returned package

#### Scenario: [SDX-ANC-RESULT-02] Range items expose stable successful evidence

- **WHEN** an eligible ancillary field range passes exact comparison
- **THEN** its public item SHALL contain the stable locator, instruction kind, source side, base/imported provenance, and `canonicalMatch: true`
- **AND** no hash alone SHALL serve as field identity

#### Scenario: [SDX-ANC-RESULT-03] Optional fields preserve compatibility

- **WHEN** a prior consumer reads a result without ancillary evidence or fallback diagnostics
- **THEN** existing result fields SHALL retain their meanings
- **AND** absence SHALL be interpreted as unavailable evidence rather than a pass

### Requirement: Real-source-derived and Lean boundaries remain explicit

The NVCA COI regression SHALL load the checked-in
`tests/test_documents/nvca-coi-regression/source.docx` as the real package
substrate and derive a revised copy by applying exported
`replaceParagraphTextRange` to a minimal body-text range unrelated to the
ancillary fields under test. The source-derived pair SHALL run once with true
inplace selected and once with forced rebuild. Both successful results SHALL
contain nonzero selected-footer PAGE evidence and nonzero footnote REF evidence,
with concrete part/entry provenance and exact canonical matches. This
requirement makes no PAGE-field claim about the checked-in `filled.docx`.

This capability SHALL NOT synthesize ancillary revisions, compare ancillary
text, evaluate fields, paginate content, resolve bookmarks, or claim complete
note-definition/reference or relationship integrity. The compiled Lean checker
SHALL remain executable protocol v3, inplace-only, and fixed to
`word/document.xml`, `word/footnotes.xml`, and `word/endnotes.xml`. Headers and
footers SHALL remain excluded. Dynamically relationship-addressed Lean stories
SHALL remain the next separate verification slice.

#### Scenario: [SDX-ANC-BOUNDARY-01] NVCA COI source-derived pair supplies non-vacuous evidence in both modes

- **GIVEN** the checked-in NVCA COI `source.docx` and a revised copy created from it by one minimal unrelated body edit through exported `replaceParagraphTextRange`
- **WHEN** the real source-derived pair is compared once with true inplace and once with forced rebuild
- **THEN** each run's successful evidence SHALL include at least one selected-footer PAGE range with concrete part provenance and an exact canonical match
- **AND** each run's successful evidence SHALL include at least one footnote REF range with concrete part, entry-ID, source side, and base/imported provenance and an exact canonical match
- **AND** the inplace run SHALL report `inplace` and the forced run SHALL report `rebuild` in both reconstruction result and ancillary evidence

#### Scenario: [SDX-ANC-BOUNDARY-02] Runtime evidence remains structural and preservation-only

- **WHEN** ancillary field evidence passes
- **THEN** the result SHALL claim only selected valid binding structure, strict story field structure, provenance, and exact eligible-range preservation
- **AND** it SHALL NOT claim ancillary text equivalence, field values, pagination, bookmark resolution, or complete note integrity

#### Scenario: [SDX-ANC-BOUNDARY-03] Lean protocol and scope remain unchanged

- **WHEN** document-integrity evidence is requested for comparison
- **THEN** the compiled checker SHALL still speak protocol v3 and run only for inplace output
- **AND** its fixed story scope SHALL remain main, footnotes, and endnotes
- **AND** headers and footers SHALL remain explicit certificate exclusions
