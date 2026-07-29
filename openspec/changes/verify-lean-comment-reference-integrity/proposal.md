# Change: Verify relationship-selected comment reference integrity in Lean

## Why

The compiled protocol-v5 Lean checker proves note reference integrity but still
lists legacy comments as unchecked. A package can therefore pass while an
admitted `w:commentReference` has no unique definition, while the fixed main
relationships select an unsafe or ambiguous Comments part, or while a relocated
valid Comments part is ignored.

## What Changes

- Migrate the private compiled-checker protocol from v5 to v6. Inputs remain
  the three immutable original, revised, and compared DOCX package paths.
- Independently select zero or one exact internal Transitional Comments
  relationship from `word/_rels/document.xml.rels`. Prove the complete selector
  result: `none` exactly for zero exact-type records, `some` exactly for one
  admissible internal record, and a typed error for every malformed, external,
  unsafe, or ambiguous record set. Normalize a safe relocated target and
  require a Transitional `w:comments` root whose definitions are direct
  `w:comment` children, even when every definition is unreferenced.
- Reuse retained, already admitted main, header/footer, footnote, and endnote
  XML events as the complete comment-reference source set. Do not accept a
  TypeScript manifest, rescan package files, or follow references recursively.
- Parse every `w:id` through the existing bounded `ST_DecimalNumber` policy,
  require every reference to resolve to exactly one direct definition, reject
  canonical duplicate definitions, and permit unique unreferenced definitions.
- Fail a side closed with zero exposed semantic counts when its source set is
  incomplete or its required Comments part cannot be selected, loaded, decoded,
  parsed, root-checked, or completely scanned.
- Charge Comments-part metadata, extraction, expansion, depth, XML events, and
  all cumulative side/triple usage against the existing package budgets before
  decompression, parsing, or ID reads; stop all later work after the first
  global resource crossing.
- Add exact selector, source-set, parsed-evidence, package-integrity,
  selector-to-request-bound-realization, incomplete-side, aggregate, and
  production-refinement theorem contracts.
  The seven semantic targets operate only on bounded bytes and typed
  relationship/package/index/extraction/XML-event/protocol values and use a
  structurally recursive byte encoder; their signatures and closures contain
  no strings, JSON, IO, production code, or LeanSpike declarations.
  The selected branch binds exactly one semantic evidence value to the retained
  one-call scan over the same request-bound Comments realization, canonical
  admitted source set, and retained source scans; aggregate counts and the
  response use that identical evidence.
  Audit those semantic targets as axiom-free; audit five concrete executable
  UTF-8 refinement bridges and the production target against the exact existing
  foundational set only, using recursively discovered exact dependency
  closures.
- Add an independent typed protocol-v6 projection, drift witnesses, strict
  TypeScript decoding, deterministic ordering/coalescing/crossing rules, exact
  structural charge inequalities, an ordinary near-envelope coexistence
  witness, canonical terminal limit fixtures, and immutable snapshot/cleanup
  guarantees.
  Construct the typed expected response from the independent semantic
  projection rather than decoding the production response, then require every
  inherited and comment field plus canonical stdout bytes to match.
- Keep public document-integrity certificate protocol v1 and add optional,
  human-readable legacy-comment scope, selected-part, inventory, and bounded
  failure evidence.
- Add real-DOCX baseline and mutation evidence for relocation, ancillary-story
  references, missing and malformed infrastructure, numeric aliases, and
  duplicate or missing definitions.
- Update coverage and ECMA-376 traceability for Part 1 §§17.13.4.2,
  17.13.4.5, 17.13.4.6, and 17.18.10, including the `CT_Comment →
  CT_TrackChange → w:id → ST_DecimalNumber` chain and a generalized decimal-ID
  registry claim.

## Impact

- Affected specs: `docx-comparison`, `spec-compliance`
- Affected code after approval: Lean selector/semantics/checker/protocol,
  TypeScript strict decoder and additive certificate types, focused and
  real-DOCX tests, axiom/dependency audits, coverage registry, and generated
  conformance documentation
- Compatibility: private protocol-v5 requests and responses migrate to v6;
  public certificate protocol v1 remains backward compatible and downstream
  users still do not install Lean
- Scope: Transitional legacy Comments parts selected from the relationships of
  fixed `word/document.xml`, for inplace comparison only
- Explicit exclusions: `w:commentRangeStart`/`w:commentRangeEnd` pairing,
  nesting, topology, and range-to-reference correspondence; author, date,
  initials, content, rendering, or reply semantics; Microsoft
  `commentsExtended.xml`, `commentsIds.xml`, `people.xml`, threading, parent
  graphs, durable IDs, resolved state, and presence metadata; Strict
  namespaces; full OPC/content-type/schema validation; rebuild certification;
  and complete ECMA-376 conformance
- Refs: #672, #640, #631, #547
