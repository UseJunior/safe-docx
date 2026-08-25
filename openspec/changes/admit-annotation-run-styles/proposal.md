# Change: Admit annotation run styles

## Why

Annotation import currently fails closed on ordinary named character styles,
including the FootnoteTextChar and Hyperlink styles used by real Word documents.
The canonical annotation model must retain these references so projection does
not flatten inherited formatting.

## What Changes

- Admit resolvable `w:rStyle` references and direct `w:sz` values in annotation bodies.
- Retain style identifiers and half-point sizes in canonical Markdoc annotation runs.
- Re-emit retained values when projecting annotations as comments or footnotes.
- Reject missing and cyclic style chains without partially importing a document.

## Impact

- Affected specs: docx-markdoc
- Affected code: docx-markdoc annotation import/model and docx-core comment/footnote emitters
- Tracking issue: #951
