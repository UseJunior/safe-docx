## 1. Proposal and review

- [ ] 1.1 Validate this OpenSpec change in strict mode, confirm scenario IDs are unique across all active `docx-markdoc` deltas, and pin `add-structural-table-row-operations` plus `add-markdoc-table-row-operations` to archive before this change.
- [x] 1.2 Obtain Claude Fable review and resolve every actionable finding.
- [x] 1.3 Merge this approval-only proposal with green required checks before implementation begins; add the coverage-enforced `docx-primitives` and `mcp-server` deltas together with their mapped tests in the implementation PR.

## 2. Selected-story comparison

- [x] 2.1 Generalize the existing selected header/footer inventory to compare admitted ordinary paragraph stories without raw-path identity.
- [x] 2.2 Pair physical stories by exact binding closure and compare a scaffold fingerprint that blanks admitted ordinary text; do not reuse content-sensitive text-box pairing keys.
- [x] 2.3 Extend relationship-walked field state-machine validation to every selected header/footer part.
- [x] 2.4 Preserve story roots, relationships, fields, tables, drawings, content controls, and other scaffold while splicing compared paragraph content.
- [x] 2.5 Emit typed unsupported diagnostics for topology, binding, scaffold, nested-story, or pairing changes outside the admitted subset.
- [x] 2.6 Prove accept/reject parity for ordinary header/footer text, field-bearing text, table-cell paragraphs, shared stories, and unchanged-story controls.
- [x] 2.7 Remove represented slots across the edited story's complete binding closure from `unrepresentedChanges` while unsupported ones remain visible.

## 3. Story-scoped primitives and package projection

- [x] 3.1 Extend accept/reject to relationship-selected header/footer parts and aggregate per-part counters without applying note-specific pruning rules.
- [x] 3.2 Add story-scoped paragraph bookmark, lookup, text replacement, insertion, deletion, and table-cell validation APIs keyed by OPC part path plus anchor and sharing one package-wide bookmark reservation set.
- [x] 3.3 Add the `docx-primitives` OpenSpec delta and mapped tests for relationship-selected accept/reject, package-wide bookmarks, story-local lookup, story-DOM table safety, both accept/reject counter families, and deliberate orphan-part exclusion.
- [x] 3.4 Update the MCP `accept_changes` contract, implementation text, and tests so supported header/footer revisions are no longer described as deferred; base the MODIFIED requirement on `add-structural-table-row-operations` so deleted rows remain resolved and absent with `unresolvedRowRevisions=0`.
- [x] 3.5 Dry-run OpenSpec archive on a scratch copy after the two row changes archive and verify the canonical MCP requirement retains their resolved-row semantics plus selected header/footer support.

## 4. Markdoc import and syntax

- [x] 4.1 Anchor mechanically admitted paragraphs in selected header/footer parts without mutating the caller's original DOCX.
- [x] 4.2 Emit deterministic story declarations, complete sorted binding closures, fingerprints, and story-scoped `para` blocks with per-story scaffold counts.
- [x] 4.3 Extend IR and validation so side-story operations require a declared story and cannot resolve a body or different-story anchor.
- [x] 4.4 Keep existing body-only Markdoc syntax and import output backward-compatible.

## 5. Replay and certification

- [x] 5.1 Apply admitted paragraph replacement/insertion/deletion inside the declared story with story-root formatting and table-cell safety rules.
- [x] 5.2 Fail before mutation for story creation/deletion/rebinding, structural table/drawing/field/content-control edits, nested text boxes, stale identity, and partial shared-story aliases.
- [x] 5.3 Reject external comment/annotation materialization for side-story operations while preserving and exporting internal rationale metadata.
- [x] 5.4 Add per-story source/reject and clean/accept text, formatting, scaffold, relationship, binding, and unresolved-revision checks to the certificate.
- [x] 5.5 Exclude only edited story parts from byte-level unchanged-parts comparison and make aggregate delivery depend on every semantic story report.

## 6. Evidence and documentation

- [x] 6.1 Add OpenSpec-tagged public tests for default/first/even bindings, shared parts, punctuation-adjacent date edits, table-cell edits, fields, section-count or selector-set changes, `w:sectPrChange`/`w:titlePg`/even-odd changes, orphan header parts, and all fail-closed boundaries.
- [x] 6.2 Add a de-identified real-DOCX end-to-end import/compile/accept/reject/render fixture, run `check_emitted_document_schema.mjs`, and open clean/accepted/rejected projections in LibreOffice.
- [x] 6.3 Update the Markdoc README and capability boundary documentation with syntax, shared-story behavior, and non-goals.
- [x] 6.4 Run the mandatory build, lint, test, spec-coverage, and conformance gates.
- [ ] 6.5 Obtain Claude Fable implementation review, resolve all findings, merge, and run post-merge smoke verification.
