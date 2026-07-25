## 1. Lean selector and proof

- [x] 1.1 Add bounded Transitional namespace-aware parsing for the exact
  accepted XML, direct `w:sectPr`, package relationship-record, ZIP, and target
  subsets, including exactly one direct body, terminal body-level `w:sectPr`
  placement, out-of-section reference issues, and structural validation of
  unselected relationship records.
- [x] 1.2 Implement the bounded Lean binary classic-ZIP EOCD/central/local
  index, filename/extra-field/flag/method/offset/range checks, exact-name
  uniqueness, every-central-record disk-start-zero check, unconditional
  `0x0001` ZIP64-extra rejection, exact method `0`/`8` flag masks,
  central-consistent complete local-record spans ending no later than the
  central-directory start, span non-overlap, and explicit
  ZIP64/multi-disk/encryption rejection.
- [x] 1.3 Permit `unzip -p --` only after unique safe binary indexing and
  require exact indexed expanded length and CRC-32 correspondence.
- [x] 1.4 Add safe internal target normalization, expected relationship/root
  checks, the pinned stable issue-code union, metadata-first aggregate budgets,
  canonical main/relationship/footnotes/endnotes admission phases, bounded
  event-to-token parsing, and exact selector-observable section-count/slot
  alignment.
- [x] 1.5 Build deterministic logical-slot evidence and deduplicated physical
  story triples while retaining every side's relationship ID and normalized
  path.
- [x] 1.6 Require successful required-main extraction/UTF-8/root/tokenization/
  inventory before any v4 response; add structured optional-note failures; and
  feed truthful fixed plus selected stories through the generic checker.
- [x] 1.7 Prove
  `direct_binding_selection_complete`,
  `aligned_slot_unique_work_item`,
  `dedup_preserves_selector_locators`, and
  `relationship_story_aggregate_sound`; quantify per-side issue-or-slot
  completeness, canonical ordered locator equality, exact loaded-work token
  correspondence, and make the aggregate theorem invoke
  `story_collection_checker_sound`.
- [x] 1.8 Add all four exact `Tier2.RelationshipStorySelector.*` targets to
  `AxiomAudit.lean`, retain existing targets, and keep zero `sorry` with the
  unchanged exact six-name observed union.

## 2. Internal protocol v4 and public certificate v1

- [x] 2.1 Replace executable protocol v3 with exact-key protocol v4; accept
  only three package paths and reject manifests, pre-resolved targets,
  unsupported versions, and producer conclusions.
- [x] 2.2 Implement the exact nested request/response interfaces, literal
  enums, separate fixed/selection issue codes, optional issue locators, strict
  recursive unknown-key policy, ordering/cardinality/dedup equations, empty-v4
  presence mismatches, and overall pass equation specified in the design.
- [x] 2.3 Update the TypeScript launcher to send v4 only and strictly reject
  unknown, duplicate, out-of-order, inconsistent, or unbounded v4 output.
- [x] 2.4 Keep public certificate protocol v1 and all existing fixed fields;
  implement the exact co-present fixed failure plus four relationship fields,
  widen internal-version metadata to `3 | 4`, and retain legacy v1 decode tests.
- [x] 2.5 Keep verifier execution inplace-only and preserve rebuild
  `not_applicable`; map post-main relationship/selected/optional failures to
  structured `failed`; and reserve `not_run` for required-main, binary-index,
  extractor-correspondence, process, and protocol failures.
- [x] 2.6 Enforce reduced cardinality/string ceilings and the 1 MiB aggregate
  emitted-string budget with 512 bytes reserved for either terminal issue;
  prove selector ordinals partition exactly once across physical stories; and
  add compiled worst-escaping maximum-schema fixtures for one story with the
  legal 192-selector single-kind maximum and 384 stories with one selector
  each, each accepted by the strict decoder and below 8 MiB.

## 3. Executable, launcher, and real-document evidence

- [x] 3.1 Add compiled synthetic tests for multiple sections, all six
  header/footer kind-role combinations, side-specific IDs/paths, fixed stories,
  deterministic ordering, and shared-target deduplication.
- [x] 3.2 Add adversarial tests for section count and selector-observable
  ordered-slot mismatch, plus explicit selector-indistinguishable non-claims;
  duplicate bindings/IDs, missing or malformed rels, missing/ambiguous/wrong
  type/external relationships, unsafe targets, missing parts, malformed/wrong
  roots, Transitional-vs-Strict namespaces, XML declarations/entities/
  comments/PI/CDATA/DTD/QNames/expanded attributes, classic EOCD ambiguity,
  ZIP64 sentinels and `0x0001` extras, nonzero central disk starts,
  multi-disk/encryption/data-descriptor/patch/strong-encryption/reserved flags,
  method-specific flag-mask violations, central/local name mismatch,
  UTF-8/ASCII and Unicode Path ambiguity, duplicate/unsafe/glob names,
  complete local-record span sizes/offsets/overlaps, CRC/extractor correspondence,
  percent/Unicode behavior, aggregate limits, malformed/duplicate unselected
  records, raw/repeatedly-decoded glob metacharacters, malformed body/terminal
  section shapes, partial selected-part loading, and unreferenced malformed
  parts.
- [x] 3.3 Add protocol fixtures for v4-only requests, no trusted manifest,
  exact response shape, mandatory-main `not_run`, structured relationship/
  selected/optional failures, ordering/uniqueness/count/pass consistency,
  output bounds, timeout cleanup, and explicit migration of every v3 fixture.
- [x] 3.4 Extend the checked-in NVCA COI source-derived true-inplace test to
  require non-vacuous v4 relationship evidence and mutate every selected
  deduplicated header/footer target in the compared snapshot only with
  parser-accepted token-observable XML; require unchanged successful selection,
  the corresponding failed story check, and all shared-target slot locators.
- [x] 3.5 Add compiled corruption probes proving that more than 256 unique
  paths and relationship metadata byte overflow perform no selected-target
  decompression, relationship admission precedes optional notes, an optional
  byte crossing is a fixed-story issue without extraction, and aggregate XML
  event exhaustion, including exact equality with the per-part ceiling, stops
  later sides and physical work while larger aggregate headroom preserves
  genuine per-part classification.

## 4. Coverage, conformance, and CI

- [x] 4.1 Move the Lean checker coverage ledger and verifier/Tier 2 docs to
  protocol v4 with exact selected surfaces, classic-ZIP-only binary inventory,
  required-main status boundary, ordinal alignment, normalization, limits, and
  exclusions.
- [x] 4.2 Update ECMA-376 registry `verifiedBy` evidence only for Part 1
  §§17.10.2, 17.10.3, 17.10.4, and 17.10.5; label normalization, containment,
  alignment, deduplication, and aggregation as SafeDocX policy.
- [x] 4.3 Regenerate `spec-compliance/CONFORMANCE.md` and keep checker coverage,
  citation, generated-doc, and OpenSpec traceability checks passing.
- [x] 4.4 Update Lean CI path filters and run the focused compiled protocol v4
  verifier and NVCA mutation suites after `lake build`.

## 5. Exact acceptance checks

- [x] 5.1 `openspec validate extend-lean-to-relationship-stories --strict`
- [x] 5.2 `cd verification/lean && lake build`
- [x] 5.3 `cd verification/lean && lake env lean AxiomAudit.lean > /tmp/axiom-audit-raw.txt && node ../../scripts/normalize_lean_axioms.mjs /tmp/axiom-audit-raw.txt > /tmp/axiom-audit-observed.txt && sort -u expected-axioms.txt > /tmp/axiom-audit-expected.txt && diff -u /tmp/axiom-audit-expected.txt /tmp/axiom-audit-observed.txt`
- [x] 5.4 `find verification/lean -name '*.lean' -not -path 'verification/lean/.lake/*' -print0 | xargs -0 grep -nwH sorry` returns no matches
- [x] 5.5 `npm run test:run -w @usejunior/docx-compare -- src/baselines/atomizer/leanXmlVerifier.test.ts`
- [x] 5.6 `npm run test:run -w @usejunior/docx-core -- src/integration/nvca-coi-regression.test.ts`
- [x] 5.7 `npm run check:lean-xml-checker-coverage && npm run check:spec-coverage && npm run check:conformance-citations && npm run check:conformance-doc`
- [x] 5.8 `npm run build && npm run lint:workspaces && npm run test:run && npm run check:spec-coverage && npm run check:conformance-citations && npm run check:conformance-doc`
  (`build`, lint, and documentation gates pass; the effective broad test
  matrix passes package-by-package while excluding only the three docx-core
  and four ODF tests that launch external LibreOffice.)
