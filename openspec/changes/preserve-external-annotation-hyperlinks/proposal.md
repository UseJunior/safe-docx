# Change: Preserve external annotation hyperlinks

## Why

Canonical annotation import currently rejects relationship-backed external
hyperlinks in otherwise admitted comment and footnote bodies. That prevents
real Word annotations from surviving Markdoc round trips even when their text
and run formatting are already losslessly representable.

## What Changes

- Resolve annotation-body `w:hyperlink` relationship IDs against the owning
  comment or footnote relationship part and retain the external destination in
  canonical annotation runs.
- Serialize and parse that destination explicitly in canonical Markdoc.
- Re-emit hyperlink wrappers and collision-free external relationships for
  comment and footnote projections, including cross-presentation conversion.
- Fail closed for internal anchors, missing or invalid relationships, and
  unsupported hyperlink contents while keeping bookmark markers unsupported.
- Extend synthetic and real-document verification through package XML and
  relationship inspection.

## Impact

- Affected specs: docx-markdoc, spec-compliance
- Affected code: docx-markdoc annotation import/model/parser/projection;
  docx-core comment/footnote emission and relationship helpers
- Compatibility: additive canonical run metadata and Markdoc syntax; internal
  hyperlinks and bookmark navigation remain explicit non-goals
- Tracking issue: #956
