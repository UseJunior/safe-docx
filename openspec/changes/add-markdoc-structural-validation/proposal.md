# Change: Add Markdoc structural validation and edit warnings

## Why

Safe DOCX preserves formatting reliably when the caller supplies the correct structural peer, but a syntactically valid insertion can still choose an anchor that slices a parent from its descendants or inherits the wrong hierarchy. The Junior harness already contains battle-tested deterministic rules for these mistakes, but those rules currently live above Safe DOCX and cannot protect Markdoc authors or other editing-tool callers.

## What Changes

- Add a product-neutral structural-validator contract to `docx-markdoc` with stable codes, severity/outcome, source location, evidence, and a suggested corrective anchor when one is deterministic.
- Port the semantics of the harness parent-child-slicing rule to the Safe DOCX document/operation model; do not couple Safe DOCX to the harness's Python hook registry, retry state, Aspose objects, or legal-content classifiers.
- Run structural validation after Markdoc schema validation and source resolution, before mutation or output writes.
- Surface the same diagnostics from `docx-markdoc validate`, compilation, and applicable editing-tool responses so agents receive actionable warnings.
- Start with parent-child slicing, then migrate level mismatch and mid-list renumbering rules behind the same registry when their semantics are proven against Safe DOCX fixtures.

## Impact

- Affected specs: `docx-markdoc`, `mcp-server`
- Affected code: `packages/docx-markdoc`, `packages/docx-mcp`, shared document outline/numbering inspection primitives
- Dependency: builds on `add-brownfield-markdoc-authoring`
- Compatibility: diagnostics are additive; strict compilation may newly reject structurally unsafe operations before writing output
