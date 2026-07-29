## 1. Independent semantics

- [ ] 1.1 Add byte-native typed marker kinds, physical-story/event ordinals,
  bounded per-ID association state, inventories, issues, and protocol-v7 values
  without importing production, `String`, `Lean.Json`, `IO`, or LeanSpike.
- [ ] 1.2 Define the exact semantic source domain from retained main,
  header/footer, footnote, and endnote `StorySlot` values and the selected
  Comments realization; prove omitted, injected, duplicated, reordered, or
  cross-boundary evidence is rejected.
- [ ] 1.3 Define one structural-recursive bounded scan for starts, ends, and
  references with explicit event/source/occurrence counters and first-crossing
  evidence.
- [ ] 1.4 Define the per-canonical-ID point/ranged disjunction, exact-one
  reference/definition rules, same-physical-story association, and
  start-before-end rule while permitting cross-paragraph and crossing ranges.
- [ ] 1.5 Add semantic negative witnesses for duplicate references/endpoints,
  orphan endpoints, reverse order, cross-story markers, missing reference or
  definition association, incomplete scans, detached realizations, and hidden
  endpoint-only IDs.
- [ ] 1.6 Add a positive semantic witness proving that one unique direct
  definition absent from the reference/start/end ID union remains valid and is
  counted exactly once as unreferenced.

## 2. Typed mirror and proofs

- [ ] 2.1 Implement and prove the seven exact protocol-v7 semantic theorem
  propositions pinned in the design for selector, realization, complete
  sources, exact marker scan, range integrity, incomplete zero evidence, and
  aggregate/serialization soundness.
- [ ] 2.2 Prove all seven semantic targets and their recursive closures
  axiom-free; keep the repository at zero `sorry`.
- [ ] 2.3 Implement typed package/source/event adapters and prove direct
  retained `visitedEvents` projection equivalent to the independent scan
  without copied whole-event lists.
- [ ] 2.4 Add separately named source, marker-scan, definition-realization,
  incomplete, UTF-8/JSON, and production refinements with the six exact
  propositions pinned in the design, using exactly
  `[propext, Classical.choice, Quot.sound]` and the existing normalized
  six-name whole-file allowlist only.
- [ ] 2.5 Extend exact-signature, module-provenance, recursive dependency,
  missing-required, forbidden-extra, no-LeanSpike, foundational-axiom, and
  zero-sorry audits.
- [ ] 2.6 Prove typed/executable agreement for a selected Comments realization
  containing a unique definition-only ID, including exact
  `unreferencedDefinitions = 1`, zero source markers for that ID, and no
  topology issue.

## 3. Executable scanner and protocol v7

- [ ] 3.1 Replace the comment source `zipIdx`/copied-list execution path with
  one tail-recursive or iterative pass over retained realizations and their
  `visitedEvents`, carrying explicit source and event ordinals.
- [ ] 3.2 Collect starts, ends, and references together; enforce the exact
  4,096 occurrence counters and the 4,096-ID union of references/starts/ends
  with exact
  `COMMENT_UNIQUE_REFERENCE_OR_RANGE_ID_LIMIT_EXCEEDED` precedence; stop at the
  first semantic crossing with side-wide zero evidence and skipped later-side
  work.
- [ ] 3.3 Reuse the selected Comments realization and direct-definition scan
  without a package read, snapshot write, extraction, parse, relationship walk,
  story discovery, or second source scan.
- [ ] 3.4 Implement deterministic canonical topology issues, code-specific
  extras/forbidden fields, ordinal spaces, source-set/event ordinals,
  coalescing identities, per-ID precedence, and the total comparator pinned in
  the design; do not add overlapping mismatch aliases.
- [ ] 3.5 Migrate the private request/response/checker identity from v6 to v7,
  retain exactly 16 top-level fields, extend inventories with start/end counts,
  and reject private v6.
- [ ] 3.6 Implement the independent protocol-v7 projection and drift witnesses
  for every inherited/new field, inventory equation, issue shape/order,
  terminal form, final canonical bytes, and stdout newline.
- [ ] 3.7 Add exact terminal/coalescing/charge/envelope proofs and
  `ProtocolV7StructuralChargeAudit`,
  `ProtocolV7OrdinaryEnvelopeWitness`, and
  `ProtocolV7CanonicalTerminalShapes`; derive decoder limits from the proofs
  while retaining the 8 MiB stdout hard cap.

## 4. TypeScript decoder and certificate

- [ ] 4.1 Extend public comment inventory/failure types additively and keep
  `DocumentIntegrityCertificate.protocolVersion` exactly `1` and the required
  `DocumentIntegrityCommentScope.rangeTopology` exactly `false`; add only the
  optional v1 `checkerProtocolVersion: 7`, topology profile, and range counts
  pinned in the design.
- [ ] 4.2 Implement strict protocol-v7 decoding for exact keys, canonical JSON,
  checker identity, side order, inventory bounds/equations, all issue
  code/extras/ordinals/sentinels, wire-visible source-partition/story identity,
  event-ordinal bounds, the `65..16,777,216` raw-ID byte-length bound,
  deterministic order/coalescing, and terminal exclusivity; leave the
  retained-event-to-marker equation to the Lean projection theorem without
  reparsing package XML.
- [ ] 4.3 Reject v6, unknown/extra/missing fields, noncanonical wire IDs,
  impossible count/status combinations, malformed physical sources, issue
  aliases, invalid envelopes, and partial terminal responses.
- [ ] 4.4 Project optional human-readable paired-or-point profile evidence and
  bounded failures into public certificate v1 with the exact presence
  equations pinned in the design; preserve old v1 decoding and rebuild
  `not_applicable` behavior.
- [ ] 4.5 Assert one package read/snapshot write per side and one retained
  selected-part extraction/parse plus one source marker scan per evaluated
  side, including cleanup after success, failure, timeout, and overflow.
- [ ] 4.6 Add strict decoder and public-projection regressions for a unique
  unreferenced definition: both range counts remain zero, definitions and
  `unreferencedDefinitions` remain one, status passes, no topology failure is
  synthesized, and emitted v7 evidence carries `checkerProtocolVersion: 7`.

## 5. Focused and differential tests

- [ ] 5.1 Add positive point, same-paragraph, cross-paragraph, crossing-range,
  and canonical-alias fixtures.
- [ ] 5.2 Add independent range fixtures in main, every selected header/footer
  physical story/role, footnotes, and endnotes, asserting physical-story
  identity and deterministic event order.
- [ ] 5.3 Add missing, malformed, and overlong ID tests for starts, ends, and
  references.
- [ ] 5.4 Add duplicate reference/start/end, orphan start/end, reversed,
  cross-story, missing-reference, and missing-definition association tests
  using only the exact issue codes pinned in the design.
- [ ] 5.5 Add maximum and over-limit start/end/reference/unique-ID tests,
  incomplete-source and substituted-`visitedEvents` tests, simultaneous
  crossing precedence, side-zeroing, and skipped-later-side tests.
- [ ] 5.6 Add strict decoder mutation coverage for every protocol field,
  inventory count/equation, issue code/extras/order/coalescing/sentinel, and
  ordinary/terminal boundary.
- [ ] 5.7 Extend Lean/TypeScript differential tests so independent typed,
  executable Lean, strict decoder, and public certificate projections agree on
  every positive and negative topology category.

## 6. Real DOCX and resource tests

- [ ] 6.1 Extend a real source-derived inplace DOCX triple with point,
  same-paragraph, cross-paragraph, and crossing comments across all retained
  story classes; assert nonzero reference/start/end/definition baselines before
  mutation without invoking LibreOffice/soffice.
- [ ] 6.2 Add compared-only real-DOCX mutations for malformed/overlong/alias,
  orphan/reverse/duplicate, cross-story/missing-association, incomplete, and
  resource-limit cases while preserving unrelated original/revised evidence.
- [ ] 6.3 Add a real-DOCX selected Comments part with one unique unreferenced
  direct definition and assert protocol-v7 inventory, strict decoding, public
  projection, and typed/executable agreement preserve it without a synthetic
  reference, endpoint, or failure.
- [ ] 6.4 Run the complete checked-in NVCA-derived triple through the exact
  TypeScript supervisor and compiled protocol-v7 binary for passing and
  structured failing mutations; reject crashes and `not_run`.
- [ ] 6.5 Add maximum-marker and large irrelevant-event stack witnesses under a
  fixed 8 MiB process stack, with no `zipIdx`, package/event `toList`, copied
  whole-event arrays, or quadratic per-event filters in the audited closure.
- [ ] 6.6 Enforce a 120-second limit and checker peak RSS below 1.5 GiB for the
  complete NVCA production path and near-limit marker/resource witnesses;
  record wall time, stack size, and peak RSS.

## 7. Conformance and coverage

- [ ] 7.1 Add exact vendored-schema/registry traces for
  `commentRangeStart`, `commentRangeEnd`, `CT_MarkupRange`, `CT_Markup`,
  `w:id`, and `ST_DecimalNumber`, inheriting existing comments
  root/definition evidence.
- [ ] 7.2 Add `@conformance` and structured test labels only for ECMA-backed ID
  typing and element semantics in §§17.13.4.3, 17.13.4.4, 17.13.4.5, and
  17.18.10.
- [ ] 7.3 Record orphan-endpoint rejection as the stronger Safe-DOCX
  paired-or-point verification profile and an explicit conformance gap; do not
  claim ECMA-required pairing or complete ECMA coverage.
- [ ] 7.4 Regenerate conformance documentation and capability/coverage
  projections and pass drift checks.

## 8. CI, review, and smoke

- [ ] 8.1 Run strict OpenSpec/spec coverage, conformance citation/document,
  generated-projection, Lean build, exact axiom/dependency, zero-sorry,
  protocol/differential, focused TypeScript, real-DOCX, and full
  non-LibreOffice gates.
- [ ] 8.2 Audit CI commands and artifacts for the fixed 8 MiB stack,
  120-second timeout, 1.5-GiB checker RSS ceiling, exact production binary, and
  complete NVCA fixture rather than a reduced path.
- [ ] 8.3 Obtain independent implementation and normative-boundary review,
  including confirmation that unmatched ECMA anchors are not described as an
  ECMA violation and crossing ranges remain accepted.
- [ ] 8.4 After merge, run exact-main production smoke over the complete
  NVCA-derived triple and representative point, ranged, crossing, orphan,
  reverse, cross-story, malformed, overlong, incomplete, and resource-limit
  cases; record results with `Refs #729`, `Refs #672`, `Refs #710`, and
  `Refs #547`.
