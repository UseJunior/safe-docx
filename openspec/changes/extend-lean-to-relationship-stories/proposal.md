# Change: Extend Lean verification to relationship-selected header and footer stories

## Why

The compiled Lean verifier independently extracts the fixed main, footnote, and
endnote stories, but headers and footers are still outside its trust boundary.
For those stories, trusting TypeScript to supply a manifest would leave section
selection, relationship resolution, and target normalization outside the
independent certificate.

## What Changes

- Move the internal executable protocol from v3 to v4 only. The request still
  supplies only immutable original, revised, and compared DOCX snapshot paths;
  it supplies no TypeScript-produced story manifest or selector conclusions.
- Make Lean independently parse each package's `word/document.xml` direct
  `w:sectPr` header/footer bindings and
  `word/_rels/document.xml.rels`, resolve safe internal typed targets, and
  require the expected `w:hdr` or `w:ftr` root.
- Require exactly one direct `w:document/w:body`; reject nested or multiple
  bodies, duplicate direct body-level terminal `w:sectPr`, and any body element
  after that terminal section before a valid selector inventory exists.
- Select only explicit direct first/default/even header/footer bindings. Do not
  implement inherited-role, pagination, or consumer fallback semantics.
- Align the three packages by logical slot `(sectionOrdinal, kind, role)`,
  retain each side's relationship ID and normalized part path, fail closed on
  section-count or ordered-slot misalignment, order evidence deterministically,
  and deduplicate shared target triples without dropping selecting slots.
- Reuse the existing generic named-story collection checker and theorem for the
  selected XML triples. Retain the fixed main, footnote, and endnote stories and
  their existing semantics.
- Return structured selection failures and fail the aggregate certificate for
  malformed, missing, ambiguous, external, unsafe, type-mismatched, or
  wrong-root selected relationships and parts, but only after all three
  required main stories truthfully tokenize and produce section inventories.
  Required-main, trusted-index, or extractor-correspondence failures remain
  process-level `not_run`; optional-note parse/limit failures are structured.
- Pin exact protocol-v4 request/response schemas, stable issue codes,
  cardinality/order/pass equations, strict recursive unknown-key rejection,
  Transitional XML/namespace and ZIP/target subsets, and finite aggregate
  package/parser/diagnostic/output budgets.
- Enforce resource admission in canonical phases: required main, relationship
  XML and all selected-target metadata/work, footnotes, then endnotes. Reject
  relationship metadata ceilings before selected decompression, classify an
  optional note crossing as its fixed-story issue without extraction, and stop
  later work when the cumulative XML-event budget is exhausted, including when
  the remaining aggregate allowance equals the per-part event ceiling.
- Replace trust in human-readable ZIP metadata with a bounded Lean binary
  classic-ZIP central-directory index. Reject ZIP64/multi-disk/encrypted or
  ambiguous archives for this increment, including any ZIP64 `0x0001` extra;
  require disk-start zero, exact method-specific flag masks, and
  central-consistent, non-overlapping complete local-record spans ending no
  later than the central-directory start; use `unzip -p --` only for exact
  indexed decompression followed by length and CRC correspondence checks.
- Bound slots, stories, issues, individual strings, and aggregate emitted
  strings so the conservative maximum response is 7,212,032 bytes. Charge
  relationship-story structure through the once-partitioned selector-ordinal
  invariant and enforce compiled shared-target (192-selector legal single-kind
  maximum) and 384-single-selector-story fixtures under the 8 MiB cap.
- Prove named selector completeness, slot-to-work uniqueness, dedup locator
  preservation in canonical order, exact loaded-work/token-triple
  correspondence, and aggregate soundness theorems. Audit all four with
  `#print axioms` while retaining the unchanged exact six-name observed union.
- Keep the public document-integrity certificate at protocol v1. Preserve all
  existing v1 fields and fixed-story meanings while adding exact optional
  relationship scope, selection, per-side identity, per-story result, and
  structured-failure shapes.
- Add synthetic adversarial relationship coverage, deterministic-order and
  shared-target tests, and real NVCA source-derived mutation tests proving that
  a parser-accepted token-observable mutation of each compared-only selected
  header/footer target reaches selection and fails its story report.
- Wire the compiled verifier integration tests into Lean CI, audit any selector
  theorem with `#print axioms` while preserving the exact existing six-name
  axiom union, and update checker coverage, ECMA registry evidence, and
  generated conformance documentation.

## Impact

- Affected specs: `docx-comparison`, `spec-compliance`
- Affected code after approval: Lean package selector/executable, TypeScript
  launcher and additive certificate types, verifier and NVCA integration tests,
  Lean CI, checker coverage ledger, verifier docs, ECMA registry evidence, and
  generated conformance docs
- Compatibility: internal protocol v3 fixtures migrate explicitly to v4; the
  public certificate remains v1 and accepts legacy v1 producers
- Scope: inplace comparison output only; no full OPC, XML Schema, rendering,
  inherited-role, or complete ECMA-376 claim
- Archive scope: classic single-disk stored/deflated ZIP without data
  descriptors only; ZIP64 and other unsupported archive forms produce
  `not_run`, while `unzip` remains an operational decompressor after Lean
  proves exact indexed identity
- Refs: #631, #547, #582
