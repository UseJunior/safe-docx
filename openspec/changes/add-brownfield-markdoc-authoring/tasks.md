## 1. Package and schema

- [x] 1.1 Add `packages/docx-markdoc` with strict ESM TypeScript configuration and package exports.
- [x] 1.2 Add `@markdoc/markdoc` and `@usejunior/docx-core` dependencies without changing existing package entry points.
- [x] 1.3 Define and test one Markdoc schema for `source`, `para`, clean `change`/`before`/`after` states, structural insertion/deletion, and `rationale`.
- [x] 1.4 Reject unknown tags/attributes, invalid nesting, duplicate operation IDs, and rationale without a target operation.

## 2. Import and inspection

- [x] 2.1 Import a DOCX into an anchored copy without mutating the caller's original, then pin the anchored package hash.
- [x] 2.2 Emit a complete compact scaffold using stable bookmark IDs, paragraph fingerprints, source text, and inherited style IDs.
- [x] 2.3 Emit selective and full normalized detail views with semantically equivalent adjacent runs coalesced and source property hashes retained.
- [x] 2.4 Report unsupported source structures and prevent v1 compilation when an edit intersects them.

## 3. Edit IR and replay

- [x] 3.1 Compile the Markdoc AST into a versioned, JSON-serializable edit IR.
- [x] 3.2 Resolve original and revised text from canonical clean states and derive tracked text deterministically through comparison.
- [x] 3.3 Implement whole-paragraph replacement/deletion and adjacent paragraph insertion with exact-once stable-anchor application.
- [x] 3.4 Implement deterministic formatting inheritance and fail closed on mixed-format ambiguity.
- [x] 3.5 Produce clean and native tracked-change DOCX outputs transactionally through Safe DOCX primitives/comparison.

## 4. Verification

- [x] 4.1 Verify source package hash, scaffold completeness/order, paragraph fingerprints, and original projection before mutation.
- [x] 4.2 Verify reject-all equals pinned source and accept-all equals clean output using existing accept/reject projections.
- [x] 4.3 Verify unchanged admitted package parts and paragraphs are byte- or canonical-equivalent under documented rules.
- [x] 4.4 Emit a machine-readable certificate containing capability scope, operations applied, excluded structures, and every invariant result.
- [x] 4.5 Add mutation tests proving source, anchor, fingerprint, scaffold, and formatting-policy drift fail before writing output.

## 5. Knowledge and training projections

- [x] 5.1 Export minimally contrastive source/revised edit records with bounded surrounding context, rationale, provenance slots, and verification status.
- [x] 5.2 Support caller-supplied adjacent Markdoc revisions for AI-draft/human-correction pairs without inferring actor or causation metadata.
- [x] 5.3 Document that authorization, privilege, de-identification, and training eligibility remain downstream responsibilities.

## 6. CLI, fixtures, and documentation

- [x] 6.1 Add package CLI commands for `import`, `validate`, `inspect`, `compile`, `verify`, and `export-edits`.
- [x] 6.2 Create synthetic fixtures covering unchanged context, clean-state replacement/deletion, insertion, rationale, and mixed-format refusal.
- [x] 6.3 Convert completed-matter findings into de-identified regression fixtures without client names, facts, or document text.
- [x] 6.4 Document authoring conventions, Git/revision-manifest discipline, compact/detail trade-offs, and recovery from stale anchors.
- [ ] 6.5 Run focused package tests, workspace build, OpenSpec traceability, and required Safe DOCX preflight gates.
