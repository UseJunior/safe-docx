# spec-compliance Specification

## Purpose
TBD - created by archiving change add-ecma-376-conformance-framework. Update Purpose after archive.
## Requirements
### Requirement: Top-level conformance directory

The repository SHALL host conformance machinery at a top-level directory
`spec-compliance/` rather than under `openspec/`, so the registry survives
a future migration off OpenSpec.

#### Scenario: registry lives outside openspec/

- **GIVEN** a clone of the repository
- **WHEN** a contributor reads `spec-compliance/registry/ecma-376.md`
- **THEN** the registry SHALL be parseable without invoking the OpenSpec
  CLI or any OpenSpec-specific grammar
- **AND** the file SHALL define stable serial IDs of the form
  `[ECMA-PART<N>-<section>]`

#### Scenario: framework lives inside openspec/

- **GIVEN** the OpenSpec capability `spec-compliance`
- **WHEN** `openspec validate add-ecma-376-conformance-framework --strict`
  is run with OpenSpec 1.3.1
- **THEN** the command SHALL return `Change '…' is valid`

#### Scenario: registry is multi-spec by design

- **GIVEN** the registry directory contains only `ecma-376.md`
- **WHEN** a sibling file `whatwg-dom.md` (or any other spec) is added
- **THEN** the lint and generator SHALL operate over `registry/*.md`
  without code changes

### Requirement: `@conformance` JSDoc tag grammar

Source code SHALL cite external specifications via a JSDoc `@conformance`
tag whose value matches `<SPEC> edition <N>, Part <N> § <SECTION>` and
resolves to a registry section ID.

#### Scenario: valid tag resolves to a known section

- **GIVEN** a registry entry `[ECMA-PART1-17-16-13]`
- **WHEN** a JSDoc block contains `@conformance ECMA-376 edition 5, Part 1 § 17.16.13`
- **THEN** the citation-hygiene lint SHALL accept the tag

#### Scenario: tag value missing an edition fails

- **WHEN** a JSDoc block contains `@conformance ECMA-376 Part 1 § 17.16.13` (no edition)
- **THEN** the lint SHALL fail with a grammar error

#### Scenario: tag value pointing at an unknown section fails

- **WHEN** a JSDoc block contains `@conformance ECMA-376 edition 5, Part 4 § 99.99.99`
- **THEN** the lint SHALL fail with an unknown-section error

#### Scenario: tag value containing an issue reference fails

- **WHEN** a JSDoc block contains `@conformance ECMA-376 edition 5, Part 1 § 17.16.13 (#217)`
- **THEN** the lint SHALL fail; the `#NNN` reference MUST move to a
  `@see` tag or surrounding prose

### Requirement: Conformance-gap escape hatch

Source code intentionally diverging from a normative requirement SHALL use a `@conformance-gap` tag (form: `@conformance-gap <SPEC> <citation> — <reason>`) in place of `@conformance`, so the coverage report classifies the site as a known deliberate gap rather than a missing claim.

#### Scenario: gap tag with a reason passes the lint

- **GIVEN** a JSDoc block with `@conformance-gap ECMA-376 edition 5, Part 1 § 17.16.13 — Word ≤ 2010 deviates`
- **THEN** the lint SHALL accept the tag and the coverage report SHALL
  classify the site as `intentional-gap`

#### Scenario: gap tag without a reason fails

- **WHEN** a JSDoc block contains `@conformance-gap ECMA-376 edition 5, Part 1 § 17.16.13` (no em-dash + reason)
- **THEN** the lint SHALL fail

### Requirement: Scoped citation-hygiene lint

The lint SHALL examine JSDoc blocks attached to top-level declarations
AND file-leading JSDoc blocks under `packages/*/src/**`, excluding test
files, `__tests__/` directories, `docs/`, `verification/`,
`packages/docx-core/SUPPORT.md`, and OpenSpec change/spec directories.

#### Scenario: file-leading JSDoc claim is in scope

- **GIVEN** `packages/docx-core/src/footnotes.ts` whose first JSDoc block
  is the file-leading module comment
- **WHEN** that block mentions "ECMA-376"
- **THEN** the block MUST carry `@conformance` or `@conformance-gap`,
  or the lint SHALL fail

#### Scenario: test description with ECMA-376 mention requires `.conformance()`

- **GIVEN** a test file with `describe('ECMA-376 fragmentation', …)` or
  `it('emits per ECMA-376 §17.16.13', …)`
- **WHEN** the test does not call `testAllure.conformance({…})`
- **THEN** the lint SHALL fail

#### Scenario: SUPPORT.md ECMA-376 mentions are out of scope

- **GIVEN** `packages/docx-core/SUPPORT.md` mentioning "ECMA-376" in the
  element vocabulary tables
- **WHEN** the lint runs
- **THEN** the lint SHALL NOT fail for those mentions

### Requirement: Registry entries bind to vendored XSD declarations

Every registry entry SHALL include a `schemaRef:` field with the grammar
`<repo-relative-path>#<kind>:<name>` where `<kind>` is `element`, `type`,
or `attribute`, and the lint SHALL fail if the cited declaration does
not exist in the named XSD.

#### Scenario: schemaRef resolves to a real element declaration

- **GIVEN** `schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#element:delInstrText`
- **WHEN** the lint parses `wml.xsd` via `fast-xml-parser`
- **THEN** the lookup SHALL find `<xsd:element name="delInstrText" .../>`
  at line 1750 and pass

#### Scenario: schemaRef pointing at a non-existent type fails

- **GIVEN** `schemaRef: spec-compliance/ecma-376/schemas/transitional/wml.xsd#type:CT_DelText`
- **WHEN** the lint parses `wml.xsd`
- **THEN** no `<xsd:complexType name="CT_DelText" .../>` is found and the
  lint SHALL fail (the correct declaration is `CT_Text` or
  `element:delInstrText`)

#### Scenario: schemaRef accepts both xsd: and xs: namespace prefixes

- **GIVEN** a registry entry with `schemaRef:` pointing at an OPC schema
  (which uses the `xs:` prefix) and another pointing at a Part 1 schema
  (which uses `xsd:`)
- **WHEN** the lint resolves both
- **THEN** both SHALL succeed

### Requirement: Non-Goals are first-class registry statements

The registry SHALL list explicitly out-of-scope sections under a
`## Non-Goals` heading using the same `[ECMA-PART<N>-<section>]` ID
grammar, and the lint SHALL reject any annotation pointing at a Non-Goal.

#### Scenario: annotation pointing at a Non-Goal fails

- **GIVEN** a Non-Goal entry `[ECMA-PART1-17-99]`
- **WHEN** source code contains `@conformance ECMA-376 edition 5, Part 1 § 17.99`
- **THEN** the lint SHALL fail

### Requirement: CONFORMANCE.md is generated and README files link to it

The repository SHALL generate `spec-compliance/CONFORMANCE.md` from the
registry, and the drift check `npm run check:conformance-doc` SHALL fail if
that output disagrees with the committed version. Canonical and localized
README files SHALL link to `spec-compliance/CONFORMANCE.md` without
reproducing generated claim counts.

#### Scenario: hand-editing CONFORMANCE.md fails drift

- **GIVEN** a registry with three entries
- **WHEN** a contributor edits `spec-compliance/CONFORMANCE.md` directly
  without touching the registry
- **THEN** `npm run check:conformance-doc` SHALL fail on the diff

#### Scenario: registry edit without regeneration fails drift

- **WHEN** a contributor adds a new section to `registry/ecma-376.md`
  but does not run the generator
- **THEN** `npm run check:conformance-doc` SHALL fail because the generated
  `CONFORMANCE.md` is out of date

#### Scenario: README provides progressive disclosure

- **WHEN** a reader inspects the canonical or a localized README
- **THEN** the README SHALL link to `spec-compliance/CONFORMANCE.md`
- **AND** it SHALL NOT reproduce generated section, Non-Goal, or gap counts

#### Scenario: localized README links are translated

- **GIVEN** localized READMEs such as `README.es.md`, `README.zh.md`,
  `README.pt-br.md`, and `README.de.md`
- **WHEN** a reader opens a localized README
- **THEN** it SHALL carry hand-translated static content that links to
  `spec-compliance/CONFORMANCE.md`

### Requirement: `testAllure.conformance({…})` helper

The `packages/allure-test-factory` package SHALL expose a
`testAllure.conformance({ spec, edition, part, section })` method that
emits a structured Allure label `label('conformance', '<SPEC>/edition-<N>/part-<N>/<SECTION>')`
and mirrors the existing `.openspec(…)` hook pattern.

#### Scenario: helper emits structured label

- **GIVEN** a test calling `testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '17.16.13' })`
- **WHEN** the test runs
- **THEN** the Allure result SHALL include
  `label('conformance', 'ECMA-376/edition-5/part-1/17.16.13')`
- **AND** the helper SHALL NOT overload the `story` label

### Requirement: CI gates publish conformance checks explicitly

The mandated pre-submit chain in `AGENTS.md` SHALL name
`check:conformance-citations` and `check:conformance-doc` directly, not
hide them behind `check:spec-coverage`, so contributors see conformance
as a top-level concern.

#### Scenario: pre-submit chain runs both new checks

- **GIVEN** the documented pre-submit chain in `AGENTS.md`
- **WHEN** a contributor reads the chain command line
- **THEN** both `npm run check:conformance-citations` and
  `npm run check:conformance-doc` SHALL appear by name

#### Scenario: preflight:ci includes both new checks

- **GIVEN** the root `package.json` script `preflight:ci`
- **THEN** the script SHALL invoke both new conformance checks
  alongside existing checks

### Requirement: Relationship-selected Lean evidence keeps conformance claims bounded

The ECMA-376 registry SHALL bind relationship-selected Lean implementation and
test claims only to edition 5 Part 1 §17.10.5 for direct typed
`w:headerReference` bindings, §17.10.2 for direct typed
`w:footerReference` bindings, §17.10.4 for selected `w:hdr` roots, and
§17.10.3 for selected `w:ftr` roots. Registry `verifiedBy` entries SHALL name
the actual Lean selector/executable and compiled or real-DOCX tests that
exercise each claim.

Safe internal target normalization, bounded repeated percent decoding with
unsafe or ambiguous results rejected, package containment, section ordinal
alignment, selector-observable section-count or ordered-slot failure,
single-direct-body and terminal-section inventory constraints, deterministic
ordering, shared-target deduplication, partial successful-evidence retention,
structured failure aggregation, and certificate compatibility SHALL be
identified as SafeDocX safety or evidence policies rather than consequences of
those Part 1 clauses.
The checker coverage ledger and generated conformance documentation SHALL state
the exact relationship-selected surface, Transitional-only namespace policy,
accepted XML/target subset, classic-ZIP-only binary index, required-main
`not_run` boundary, unconditional ZIP64-extra rejection, method-specific flag
masks, complete local-record span policy, selector-partitioned response bound,
aggregate verifier/evidence limits, canonical main/relationship/footnotes/
endnotes resource admission, metadata-before-decompression enforcement,
bounded event-to-token parsing, typed failure reasons with equality-inclusive
aggregate event classification, and exclusions.

This change SHALL NOT add a full OPC, relationship-graph, content-type, XML
Schema, inherited-role, pagination, rendering, field-evaluation, bookmark, or
complete ECMA-376 claim. It SHALL NOT add unsupported Part 2 citations.

#### Scenario: [LEAN-REL-CONFORMANCE-01] Binding and root citations match exercised structure

- **WHEN** implementation or tests claim direct typed header/footer bindings or
  selected header/footer roots
- **THEN** their conformance evidence SHALL cite only the corresponding
  registered Part 1 §§17.10.2, 17.10.3, 17.10.4, or 17.10.5
- **AND** `verifiedBy` paths SHALL identify the Lean and test evidence that
  actually exercises the claim

#### Scenario: [LEAN-REL-CONFORMANCE-02] Selector safety remains repository policy

- **WHEN** target normalization, package containment, ordinal alignment,
  deterministic ordering, deduplication, failure aggregation, or certificate
  compatibility is documented or tested
- **THEN** it SHALL be labeled as a SafeDocX policy or verifier invariant
- **AND** it SHALL NOT be attributed to the bounded header/footer Part 1 clauses

#### Scenario: [LEAN-REL-CONFORMANCE-03] Coverage docs preserve explicit non-goals

- **WHEN** protocol v4 coverage and generated conformance documentation are
  checked
- **THEN** they SHALL list direct explicit selected header/footer stories as
  covered and fixed main/footnote/endnote stories as retained
- **AND** they SHALL explicitly exclude inherited roles, unselected parts,
  complete relationship/OPC/schema validation, pagination, rendering, and full
  ECMA-376 conformance

#### Scenario: [LEAN-REL-CONFORMANCE-04] Parser and resource policies are not ECMA maxima

- **WHEN** coverage docs state Transitional-only namespaces, accepted
  declarations/entities/ZIP methods/targets, classic-ZIP-only binary inventory,
  ZIP64-extra/disk-start/flag/local-span policy, required-main process boundary,
  selector-partitioned serialization bound, canonical resource phases,
  metadata-before-decompression policy, or numeric resource/evidence ceilings
- **THEN** they SHALL identify those choices as bounded verifier policy
- **AND** they SHALL NOT present rejected Strict syntax, unsupported OPC
  features including ZIP64, or values above the ceilings as nonconformant with
  ECMA-376

#### Scenario: [LEAN-REL-CONFORMANCE-05] Resource admission is verifier policy

- **WHEN** coverage documents describe metadata-first selected-target
  admission, optional-note ordering, typed parser failures, or aggregate
  XML-event stopping at or below the per-part ceiling
- **THEN** they SHALL identify these as bounded SafeDocX verifier policies
- **AND** they SHALL not attribute those limits or processing phases to the
  cited header/footer clauses
