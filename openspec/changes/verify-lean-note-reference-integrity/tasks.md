## 1. Lean note selection and integrity proof

- [x] 1.1 Add semantic `NoteKind`, typed definition classification, exact
  §17.18.10 whitespace-collapse parsing, a 64-byte pre-parse lexical bound,
  canonical evidence grammar including negative zero, package-local
  inventories, and bounded deterministic issue data.
- [x] 1.2 Select zero or one exact Transitional internal footnotes/endnotes
  relationship per package only from `word/_rels/document.xml.rels` derived
  from fixed `word/document.xml`; first filter all exact-type records without
  target-mode filtering, require total cardinality at most one, and only then
  require the sole record internal; reuse safe normalization and the binary
  ZIP index, require the expected root, and add no `_rels/.rels` discovery.
- [x] 1.3 Replace fixed conventional note loading with semantic-kind alignment
  across original/revised/compared safe paths while retaining missing-as-empty
  behavior only where the package has no unresolved references.
- [x] 1.4 Build the exact admitted partition: main and selected header/footer
  stories are valid reference sources; note stories are definition/poison-scan
  sources whose self- or cross-kind references are structured failures. Require
  an independent fully scanned realization for every expected present source,
  an exact scan domain, and at most 1,000,000 admitted events per side.
- [x] 1.5 Implement optional-note valid absence only for zero exact-type
  relationship plus zero same-kind reference elements, including malformed-ID
  occurrences; treat any selected but
  unloadable/undecodable/unparseable/wrong-root/unscanned part as failed
  presence and an incomplete side.
- [x] 1.6 Tag every incomplete side as exactly one intrinsic story failure,
  local semantic limit crossing, or skipped-after-prior-crossing cause. Bind
  intrinsic failure to the first failed
  selection/load/decode/parse/root/full-scan stage; bind local/skipped causes
  to the global original/revised/compared admission order and globally first
  semantic crossing; then zero both kinds and all hidden parsed lists.
- [x] 1.7 Implement `checkPackageNoteIntegrity`, reject canonical duplicate
  user definitions and missing matches, and permit unique unreferenced user
  definitions.
- [x] 1.8 Prove and audit the exact targets
  `Tier2.ConventionalMainNoteSelector.selected_note_identity_sound`,
  `Tier2.NoteReferenceIntegrity.admitted_source_partition_complete`,
  `Tier2.NoteReferenceIntegrity.parsed_inventory_evidence_exact`,
  `Tier2.NoteReferenceIntegrity.package_note_reference_integrity_sound`,
  `Tier2.NoteReferenceIntegrity.incomplete_partition_zero_evidence_sound`, and
  `Tier2.NoteReferenceIntegrity.note_integrity_aggregate_pass_sound`, with the
  exact signatures and propositions pinned in the design.
- [x] 1.9 Make the executable `runRequest` invoke the pure `runRequestCore`,
  which derives package views from request-bound records, invokes generic
  story checking and canonical note verification, builds the exact response,
  finalizes stdout, and is the subject of the production refinement theorem.
- [x] 1.11 Restore the axiom-free semantic
  `note_integrity_aggregate_pass_sound` over
  `canonicalSemanticResponse`, and separately prove
  `production_run_request_core_refinement_sound` over actual `runRequestCore`
  with exact normalized foundations `[propext, Classical.choice, Quot.sound]`,
  no LeanSpike engine/residual dependency, and field-complete
  `ProductionRunRequestRefinesSemanticOf`.
- [x] 1.12 Retain exact request package bytes, extracted entry bytes, successful
  parser equations, and one bounded semantic scan per side at the pure core
  boundary. Remove parser/scan/whole-package-CRC proof recomputation, expose
  one-read/one-parse/one-scan counters, and require the concrete JSON builder
  to equal an independent `semanticProtocolV5Projection` that cannot depend on
  the production builder.
- [x] 1.13 Encode protocol v5 independently at the typed field level, forbid
  every production encoder, ordering, coalescing, budget, and terminal helper
  from its recursive value dependency closure, and compile/run drift witnesses
  for field names, field values, array order, issue coalescing/budget, and
  terminal shape. Have the TypeScript supervisor create a private mode-0700
  root, pass it to Lean, and remove it after child close on success, failure,
  timeout, and output overflow. Extract only from package snapshots written
  once from the retained package bytes inside that root; retain the exact ZIP
  index, central/local offsets, compressed slice, decompressed result, and
  one-call counters; use no PATH-resolved `chmod`; surface cleanup failures;
  state external deflate as a trust boundary; and replace source-slice
  anti-recomputation checks with Lean value-call-graph audits.
- [x] 1.10 Define relationship-record, XML-event traversal, partition,
  independent load/decode/parse/full-scan, parsed-evidence,
  optional-slot satisfaction, global admission context, tagged incomplete
  cause, incomplete-side-zero-evidence, package-integrity, aggregate, and
  serialized-response predicates in the proof-only semantics module; enforce
  per-side equality between stored and independently derived canonical
  selections, derive admission events from those same selections, enforce
  forbidden-import and declaration-dependency audits, and compile every pinned
  negative non-vacuity witness.

## 2. Internal protocol v5 and public certificate v1

- [x] 2.1 Migrate to protocol v5 with exactly three source partitions, two
  semantic note-story slots, and six side-kind inventories in canonical order.
- [x] 2.2 Implement exact coalescing keys, occurrence ordinals, status/
  presence/path/relationship equations, aggregate pass equation, terminal
  collapse, total semantic/aggregate crossing precedence, side/story admission
  order, structural charging, the 2,619,776-byte realizable ordinary maximum,
  and the exact equation `2,621,440 JSON bytes + 1 newline byte =
  2,621,441 stdout bytes`.
- [x] 2.3 Make `source` a required discriminated identity on every ordinary
  v5 `noteIntegrityIssues` entry, enforce exact
  main/header/footer/footnote/endnote ordinal equations, retain
  `SelectionIssueV4` field shape/canonical ordering/coalescing unchanged
  without source fields, replace its old cardinality with the shared protocol-v5
  511 cap, omit source only on terminal note issues, and reject omitted,
  invented, or out-of-range note identities.
- [x] 2.4 Update the TypeScript launcher to send v5 only and recursively reject
  unknown, duplicate, contradictory, out-of-order, oversized, or
  pass-inconsistent output.
- [x] 2.5 Keep public certificate protocol v1, widen internal version metadata
  to include v5, add co-present optional note scope/story/inventory/failure
  evidence, and keep legacy public certificate decoders passing.
- [x] 2.6 Emit legacy `fixedStoryScope` only when all six side-kind slots were
  selected, loaded, and checked at their conventional paths; otherwise omit it.
  Preserve rebuild `not_applicable` and fatal `not_run` behavior.

## 3. Executable and real-document tests

- [x] 3.1 Add compiled synthetic tests for absent, one-kind, both-kind,
  conventional-path, alternate-path, and cross-snapshot path-difference cases.
- [x] 3.2 Add typed-definition and decimal tests for all `ST_FtnEdn` values,
  IDs 0/1, whitespace-collapse aliases, signs, leading zeroes, negative zero,
  64-byte boundaries, canonical duplicates, repeated/missing references, and
  accepted unreferenced definitions.
- [x] 3.3 Add relationship tests for missing required relationships, duplicate
  exact types including one-internal-plus-one-external, sole
  external/unsupported modes, unsafe/oversized targets, absent parts, wrong
  roots, and wrong types in reference-bearing packages.
- [x] 3.4 Add complete-partition tests: main/header/footer references are
  valid; any note-story reference is poison; recursive and cross-kind cycles
  fail; every expected present source is fully scanned within the side-wide
  event bound; valid absent note slots have no relationship and no references;
  failed presence is not absence; every incomplete cause makes both side-kind
  inventories `not_evaluated`; and a forged global selection containing an
  unselected/orphan malformed story fails the independent canonical-selection
  equation and cannot become an intrinsic cause.
- [x] 3.5 Add strict decoder tests for all recursive keys, exact cardinalities,
  all ordinal spaces, CRC-32 overlong-key collisions, coalescing, equations,
  every required source-identity discriminator/bound, each semantic crossing,
  all three incomplete-cause tags and global-order equations,
  v4-selection/v5-note cross-array admission/shared-count equations, exact
  terminal collapse, and malformed mixtures.
- [x] 3.6 Derive a fixture from the real NVCA source that adds a valid endnote
  relationship/reference/definition on all three sides; require nonzero
  footnote and endnote counts before compared-only mutations.
- [x] 3.7 Add compared-only definition, relationship, recursive/cross-kind
  poison, lexical alias, issue-collision, alternate-path, and unchanged
  header/footer assertions.
- [x] 3.8 Add `ProtocolV5StructuralChargeAudit.lean`,
  `ProtocolV5MaximumOrdinaryShape.lean`, and
  `ProtocolV5CanonicalTerminalShapes.lean`; prove the 1,571,840-byte ordinary
  string budget coexists with 511 issues at or below 2,619,776 bytes, prove
  terminal reserve use separately, prove JSON remains at or below 2,621,440
  bytes, and prove JSON plus the required newline remains at or below the
  2,621,441-byte legal stdout envelope.
- [x] 3.9 Add combined-crossing tests proving reference-occurrence wins over
  unique-ID capacity for an 8,193rd/4,097th candidate, issue-count wins when
  the 512th cross-array selection/note issue also crosses the string budget,
  selection issues are admitted before note issues, and an earlier ordinary
  string crossing wins before any later issue-count crossing.

## 4. Coverage, conformance, and CI

- [x] 4.1 Move coverage to protocol v5 with the fixed conventional-main
  boundary, poison semantics, complete partition, theorem targets, exact
  cardinalities/limits, and exclusions.
- [x] 4.2 Add or update ECMA registry entries only for Part 1 §§11.3.4, 11.3.7,
  17.11.2-17.11.3, 17.11.7-17.11.10, 17.11.14-17.11.15, and 17.18.10, bound to
  exact vendored Transitional declarations including `ST_DecimalNumber`.
- [x] 4.3 Add leading `@conformance` JSDoc and structured test citations only
  where implementation/tests exercise those clauses; keep SafeDocX policy
  claims distinct.
- [x] 4.4 Regenerate conformance and capability projections; update verifier
  docs and CI path filters.

## 5. Acceptance checks

- [x] 5.1 `openspec validate verify-lean-note-reference-integrity --strict`
- [x] 5.2 `cd verification/lean && lake build` without `lake update`
- [x] 5.3 Run empty per-target axiom diffs for all six semantic theorem targets,
  the exact three-foundation production refinement diff, then the normalized
  whole-file exact-union diff, and confirm no `sorry` outside `.lake`.
- [x] 5.4 Run focused compiled protocol-v5 and strict-decoder tests.
- [x] 5.5 Run the real NVCA inplace mutation suite without LibreOffice/soffice.
- [x] 5.6 Run checker coverage, OpenSpec traceability, conformance citation,
  conformance document, and generated projection gates.
  The implementation-specific gates pass. The repository-wide citation check
  retains the base-branch, branch-untouched
  `inPlaceModifier-empty-and-cell-paragraphs.test.ts` finding (already fixed on
  current `origin/main`), and the conformance-document check reports the
  expected dirty-tree diff until its generated output is committed; repeated
  generation is byte-identical.
- [x] 5.7 Run the repository pre-submit matrix, excluding only tests that
  launch external LibreOffice/soffice and recording the exact exclusions.
  The excluded files are
  `docx-core/src/integration/generation-package-structure.test.ts`,
  `docx-core/src/integration/lean-differential-helpers.test.ts`,
  `docx-core/src/integration/libreoffice-oracle-trust-boundary.test.ts`,
  `odf-core/src/convert/lo_convert_differential.test.ts`,
  `odf-core/src/roundtrip.test.ts`,
  `odf-core/src/compare/lo_inline_roundtrip.test.ts`, and
  `odf-core/src/compare/lo_paragraph_roundtrip.test.ts`; the non-LibreOffice
  cases in the first two mixed files pass separately.
- [ ] 5.8 Obtain independent implementation review and post-merge
  real-document smoke evidence.
