# Change: Add Brownfield Markdoc Authoring

## Why

Safe DOCX can preserve and compare arbitrary Word documents, but its current
authoring surfaces make a lawyer or model choose between editing a binary DOCX
and writing implementation-shaped edit plans. Neither is a durable knowledge
record of the source context, minimally contrastive edits, and drafting
rationale.

A completed-matter replay demonstrated that a compact full-document Markdoc
projection can remain readable while replaying 49 paragraph edits against a
hash-pinned 168-paragraph source. Reject-all reproduced the source, accept-all
reproduced the clean output, unchanged paragraph XML remained byte-identical,
and the replayed `word/document.xml` matched the existing verified build. The
experiment also exposed the wrong abstraction: separate `before` and `after`
paragraphs duplicate source text. Surgical `{% del %}` / `{% ins %}` spans and
source-anchored whole-unit operations represent the same redline once and make
the file a better authoring and archival format.

## What Changes

- Add a new workspace package, `@usejunior/docx-markdoc`, depending on
  `@usejunior/docx-core` and `@markdoc/markdoc`.
- Define a general, domain-neutral Markdoc schema for a hash-pinned source DOCX,
  complete paragraph scaffolds, clean before/after states, source-anchored
  whole-paragraph replacement/deletion, paragraph insertion, and adjacent
  rationale.
- Import a DOCX into a compact canonical projection with stable Safe DOCX
  paragraph bookmark IDs, source/package hash, paragraph fingerprints, and
  inherited style identity.
- Generate normalized selective or verbose inspection views without making
  either view canonical or embedding raw OOXML in model context.
- Compile the Markdoc AST into a validated, language-neutral edit IR and replay
  that IR through Safe DOCX to clean and native tracked-change DOCX outputs.
- Fail transactionally on changed source bytes, missing or ambiguous anchors,
  scaffold drift, invalid nesting, unsupported structure, or an operation that
  cannot honor its declared formatting policy.
- Verify reject-all against the pinned source, accept-all against clean output,
  and preservation of unchanged package content using existing Safe DOCX
  comparison and accept/reject machinery.
- Export minimally contrastive edit records suitable for downstream knowledge
  management and SFT adapters, while keeping client/matter identity and
  de-identification policy outside this general package.
- Provide CLI entry points for import, validate, inspect, compile, verify, and
  edit-pair export.

## Impact

- Affected specs: new `docx-markdoc` capability; existing `docx-primitives` and
  `docx-comparison` are consumed but their contracts are not weakened.
- Affected code: new `packages/docx-markdoc`; root workspace scripts and package
  dependency graph; de-identified fixtures derived from the matter prototypes.
- Downstream: `legal-explainer/packages/markdocx` may consume the package later
  for template authoring and SFT projection, but is not changed by this proposal.
- Compatibility: additive. Existing CLI, MCP, comparison, and generation APIs
  remain unchanged.
- Security: source and output paths use existing Safe DOCX path/archive safety;
  imports never embed source binaries or client-identifying metadata in Markdoc.
