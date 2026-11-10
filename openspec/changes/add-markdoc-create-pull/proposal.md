# Change: Pull Word edits on a create output back into its creation source

## Why

A created DOCX goes out for review, and the reviewer edits it in Word: a
wording change, a renamed defined term, a deleted heading, a new running
header and a page-number footer. The `.mdoc` it was built from no longer
describes the document. Before this change the only ways forward were to
retype each edit into the source by hand, or to pass
`--dangerously-overwrite-edited-docx` and lose the edits from the DOCX that
`create --replace` writes (#1223, part C). Parts A (#1404) and B (#1405)
gave `create` the running-text keys and the edited-output guard that this
command needs.

## What Changes

- New subcommand `docx-markdoc pull <edited.docx> <document.mdoc> [--apply
  [--output new.mdoc]] [--certificate stem.verification.json]
  [--style-profile profile.json] [--json]`.
  - It reads the certificate (`<stem>.verification.json` beside the edited
    DOCX by default). It refuses a source whose SHA-256 differs from the
    certificate's (`PULL_SOURCE_CHANGED`), and a rebuild that reproduces
    neither the certified DOCX nor its text (`PULL_BASE_MISMATCH`).
  - It rebuilds the certified build from the source, pairs the body
    paragraphs of that build with those of the edited DOCX, and reports
    each change against source lines: changed paragraphs with a word-level
    diff, deleted paragraphs, added paragraphs, and changed headers or
    footers per section.
  - With `--apply` it writes a new `.mdoc` (`<stem>.pulled.mdoc` by default,
    never an existing file) that leaves the markup of unchanged text alone.
    Edits inside fill-ins, bold, italic and underline spans and signer
    attributes are written in place. A deletion that crosses a markup
    boundary is split between the two sides, and so is an insertion whose
    formatting changes where the markup does. A container (a fill-in, a
    span, a cross-reference whose field was deleted with it) that the edit
    covers entirely is replaced. Added paragraphs take their markup from
    their style (heading, quote, centred, legend, list item, body) and
    their bold, italic and underline runs. Header and footer text maps to
    the running-text keys of the frontmatter or the `{% section %}` tag.
  - Each planned change is applied alone and kept only when the source
    still builds and reads back as expected. The whole pulled source must
    then pass every `create` check and reproduce the edited body text,
    character formatting, headers and footers, list labels (computed from
    `word/numbering.xml`) and table structure.
  - What it cannot express it reports as a typed diagnostic and leaves out
    (the paragraph stays as it was): `PULL_EDIT_CROSSES_MARKUP`,
    `PULL_EDIT_IN_CROSS_REFERENCE`, `PULL_EDIT_IN_GENERATED_TEXT`,
    `PULL_PARAGRAPH_NOT_MAPPED`, `PULL_UNMAPPED_DELETION`,
    `PULL_UNMAPPED_INSERTION`, `PULL_ADDED_PARAGRAPH_STYLE`,
    `PULL_DIRECT_FORMATTING`, `PULL_PARAGRAPH_FORMATTING`,
    `PULL_STYLE_CHANGED`, `PULL_PAGE_SETUP`, `PULL_SECTION_STRUCTURE`,
    `PULL_NUMBERING_CHANGED`, `PULL_TABLE_STRUCTURE`,
    `PULL_COMMENTS`, `PULL_FOOTNOTES_CHANGED`, `PULL_HEADER_UNMAPPED`,
    `PULL_FOOTER_UNMAPPED`, `PULL_UNSUPPORTED_CONTENT`, `PULL_FIELD_CHANGED`,
    `PULL_UNEXPRESSIBLE_TEXT`, `PULL_EDIT_NOT_VERIFIED` and
    `PULL_REBUILD_DIFFERS`.
  - Tracked changes are refused (`PULL_TRACKED_CHANGES`, exit 1): the
    reviewer accepts or rejects them in Word first. They are looked for in
    every header, footer, note and numbering part the document relates. Reading the accepted
    view silently would write rejected-by-default text into the source.
  - Exit codes: 0 no changes, 2 changes or diagnostics reported, 1 error.
- `create --replace` and the edited-output guard. A complete pull (no
  diagnostic, every change written, the rebuild equal to the edited DOCX)
  also writes `<stem>.pull.json` beside the certificate. It binds the
  edited DOCX's SHA-256, the certified build and the pulled source's
  SHA-256. `create --replace` then accepts that edited DOCX in place of the
  certified one, but only when it builds exactly that pulled source. It
  keeps the edited bytes in `.<stem>.create-overwritten-<uuid>/` as it does
  under `--dangerously-overwrite-edited-docx`, notes the replacement in its
  summary, and removes the record. Any other edited DOCX, source or
  incomplete pull is still refused with `CREATION_OUTPUT_EDITED`.
- Create internals: the lowering records, for each projected paragraph, the
  source node it came from (`paragraphEntries`, not in the certificate). The
  read-back reports run offsets and `w:fldSimple` fields. No output bytes or
  certificate change.

Not included: tracked changes as edits, comments, footnote and table
structure edits, direct formatting beyond bold, italic and underline in
added paragraphs, edits inside cross-reference results, multi-line or
formatted headers, and even-page headers. Each is diagnosed.

## Impact

- Affected specs: `docx-markdoc` (ADDED requirement).
- Affected code: `packages/docx-markdoc/src/create/` (`pull.ts`,
  `pull-source.ts`, `pull-docx.ts`, `cli-pull.ts`, `cli-create.ts`,
  `lower.ts`, `readback.ts`), `src/cli-run.ts` and `src/cli-help.ts`.
  docx-core, docx-compare and docx-mcp are not changed.
- Compatibility: `create` builds the same bytes and certificate. The
  `--replace` guard accepts one new case, only with a matching record.
