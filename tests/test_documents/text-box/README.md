# Text-Box Fixture Provenance

A before/after pair authored in Microsoft Word for Mac, used by the text-box
comparison guards. No document in the corpus previously contained a text box at
all, so every text-box test in this repository was written against hand-built
XML — which exercises the fixture builder as much as the code.

## Included files

- `source.docx`
- `revised.docx`

Source class: synthetic, authored for this repository. Written by hand in Word
purely to produce Word's own text-box markup; the content carries no customer,
partner, or private material.

## What the pair contains

Two authored text boxes and one ordinary body paragraph.

| | `source.docx` | `revised.docx` |
|---|---|---|
| text box 1 | `Text box 1` | `1st Text box is first. . .` |
| text box 2 | `Text box 2` | `This is text box number two.` |
| body paragraph | `Body text` | `Body text` |

The body paragraph is deliberately unchanged. It is the control that catches a
guard which has become over-broad and refuses documents wholesale rather than
refusing the class it is meant to exclude.

Neither file contains `w:ins` or `w:del`. They are a clean source and target for
a comparison to produce a redline *from*, not a redline themselves.

## Why the storage shape matters

Word stores each of these boxes **twice** inside a single `mc:AlternateContent`:

- `mc:Choice Requires="wps"` — the DrawingML spelling (`a:graphic`, `wps:txbx`)
- `mc:Fallback` — the VML spelling (`v:shape`, `v:textbox`)

Both branches carry identical text, and Word renders exactly one. So **two
authored boxes produce four `w:txbxContent` elements**, and the pair is the
document that distinguishes:

- counting stored copies (4) from counting boxes a reader sees (2), and
- a DrawingML box that is one half of a twin — which Word produces constantly
  and the engine handles — from a *standalone* DrawingML box with no VML twin,
  which `spec-compliance/CONFORMANCE.md` (ECMA-PART4-14-9-1-1) excludes.

Tests needing the standalone-DrawingML or a non-`v:shape` VML host derive them
from these files by selecting one `mc:AlternateContent` branch and discarding
the other. That keeps the markup Word's own rather than hand-written: what
varies is which branch Word wrote is kept, not what the branch says.

## Policy

- Do not add customer, partner, or otherwise private documents.
- Prefer package-local synthetic fixtures in
  `packages/docx-compare/src/testing/fixtures/` for new tests. Reach for a
  Word-authored file only when the markup under test is markup that Word alone
  produces faithfully — as `mc:AlternateContent` twinning is.
