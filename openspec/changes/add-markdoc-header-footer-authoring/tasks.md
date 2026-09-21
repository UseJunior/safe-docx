## 1. Proposal and review

- [ ] 1.1 Validate this OpenSpec change in strict mode.
- [ ] 1.2 Obtain Claude Fable review and resolve every actionable finding.
- [ ] 1.3 Merge the approved proposal before implementation begins.

## 2. Selected-story comparison

- [ ] 2.1 Generalize the existing selected header/footer inventory to compare admitted ordinary paragraph stories without raw-path identity.
- [ ] 2.2 Preserve story roots, relationships, fields, tables, drawings, content controls, and other scaffold while splicing compared paragraph content.
- [ ] 2.3 Emit typed unsupported diagnostics for topology, binding, scaffold, nested-story, or pairing changes outside the admitted subset.
- [ ] 2.4 Prove accept/reject parity for ordinary header/footer text, field-bearing text, table-cell paragraphs, shared stories, and unchanged-story controls.
- [ ] 2.5 Ensure represented story changes are removed from `unrepresentedChanges` while unsupported ones remain visible.

## 3. Markdoc import and syntax

- [ ] 3.1 Anchor admitted paragraphs in selected header/footer parts without mutating the caller's original DOCX.
- [ ] 3.2 Emit deterministic story declarations, complete sorted binding closures, fingerprints, and story-scoped source paragraphs.
- [ ] 3.3 Extend IR and validation so side-story operations require a declared story and cannot resolve a body or different-story anchor.
- [ ] 3.4 Keep existing body-only Markdoc syntax and import output backward-compatible.

## 4. Replay and certification

- [ ] 4.1 Apply admitted paragraph replacement/insertion/deletion inside the declared story with existing formatting and table-cell safety rules.
- [ ] 4.2 Fail before mutation for story creation/deletion/rebinding, structural table/drawing/field/content-control edits, nested text boxes, stale identity, and partial shared-story aliases.
- [ ] 4.3 Reject external comment/annotation materialization for side-story operations while preserving internal rationale metadata.
- [ ] 4.4 Add per-story source/reject and clean/accept text, formatting, scaffold, relationship, binding, and unresolved-revision checks to the certificate.
- [ ] 4.5 Make aggregate projection and delivery verdicts depend on every edited story report.

## 5. Evidence and documentation

- [ ] 5.1 Add OpenSpec-tagged public tests for default/first/even bindings, shared parts, punctuation-adjacent date edits, table-cell edits, fields, and all fail-closed boundaries.
- [ ] 5.2 Add a de-identified real-DOCX end-to-end import/compile/accept/reject/render fixture and validate it against the ECMA-376 Transitional schema.
- [ ] 5.3 Update the Markdoc README and capability boundary documentation with syntax, shared-story behavior, and non-goals.
- [ ] 5.4 Run the mandatory build, lint, test, spec-coverage, and conformance gates.
- [ ] 5.5 Obtain Claude Fable implementation review, resolve all findings, merge, and run post-merge smoke verification.

