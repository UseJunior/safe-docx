# Change: Compare text inside VML text-box stories

## Why

Safe-DOCX currently fails closed whenever `w:txbxContent` changes. That guard
prevents the outer comparison from wrapping a complete VML drawing in revision
markup that Word cannot read, but it also means one edited notice or address box
can block an otherwise valid legal-document redline.

Text inside a VML text box is WordprocessingML content with its own paragraph
sequence. It should be compared as a nested story rather than as part of the
outer drawing object.

## What Changes

- Discover paired `w:txbxContent` stories in the main document and assign each a
  deterministic locator.
- Resolve selected header/footer stories through `w:sectPr` bindings and pair
  their physical parts by semantic story identity rather than raw package path.
- Compare supported text-box paragraph content independently with ordinary
  WordprocessingML tracked insertions and deletions.
- Keep the containing VML/DrawingML scaffold out of the outer-body diff and
  splice the compared nested story back into the preserved revised scaffold.
- Require accept-all and reject-all parity for both the outer document and each
  supported text-box story.
- Treat a side-only selected header/footer story as a whole-story lifecycle only
  when every selector belongs to an inserted/deleted section; reject ambiguous
  insertion, deletion, reorder, nesting, or scaffold mutation.
- Report text-box stories as an explicit verifier coverage item; a certificate
  may not silently claim full-story coverage while the compiled verifier does
  not parse them.

## Impact

- Affected spec: `docx-comparison`
- Affected code: atomizer pipeline, text-box safety/classification, in-place
  reconstruction, round-trip validation, focused fixtures, verifier coverage
- Fixes: #713
- Related: #647, #688, #718
- Follow-up slice: #726
