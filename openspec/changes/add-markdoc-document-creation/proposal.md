# Change: Create new Word documents from Markdoc

## Why

safe-docx cannot create a new legal instrument (a board consent, written
resolution, certificate or waiver) from readable source. `compile-greenfield`
needs a template `.docx`, admits only headings and plain paragraphs, rejects
emphasis, and supports one section (#1010). Matter work therefore still uses a
per-matter python-docx renderer, which has now been copied into two matters
(#1162).

The generator is not the gap. `@usejunior/docx-core` `generateDocx` already
writes every construct that renderer writes: per-section footers, PAGE fields,
tab stops, highlight, keep-with-next and keep-lines. It also writes real
`w:numbering` lists and tables, which the renderer cannot, and its output is
byte-deterministic, which the renderer's is not. What is missing is:

1. a Markdoc authoring layer that lowers readable source onto `DocumentSpec`;
2. a house style declared once (added in docx-core by
   `add-generation-document-defaults`); and
3. one command that builds the document and proves it: read-back text against
   the source, footers, determinism, brownfield editability, and an optional
   PDF check.

## What Changes

- Add `docx-markdoc create <document.mdoc> <output-dir>`. It writes
  `<stem>.docx`, `<stem>.txt` (the read-back mirror), an optional `<stem>.pdf`
  and `<stem>.verification.json`.
- Add a closed creation grammar (see `design.md`):
  - Markdown blocks: title, headings, paragraphs, quotes, ordered and bullet
    lists bound to real numbering, hard breaks, `**bold**` and `*italic*`.
  - Markdoc tags: `{% table %}`, `{% center %}`, `{% legend %}`,
    `{% signer /%}`, `{% page-break /%}` and `{% section /%}`.
  - Explicit fill-ins (`{% fill %}…{% /fill %}`, rendered `[…]` and highlighted, nesting allowed); bare brackets are literal text, and frontmatter `fill-ins: brackets` restores automatic bracket highlighting (#1184).
  - Frontmatter: title, author, date, and the first section's footer and page
    numbers.
- Add an optional JSON house-style profile. The built-in default is Times New
  Roman 11pt on all four font channels, 8pt after, 1.15 lines, 1" margins.
- Lower through the generic markdocx engine (`add-markdocx-generic-engine`)
  onto `generateDocx`, so there is one Markdoc → DocumentSpec engine. The
  creation grammar is a validator, a creation theme, tag plugins (`center`,
  `legend`, `signer`, `table`, inline `literal`) and a small driver for
  sections, page breaks and neighbour rules. This change adds no OOXML
  emitter.
- Add one additive engine option, `hardBreaks: 'line'`. The default `'space'`
  keeps the engine's lenient contract for existing adapters.
- Verify every build, and fail the build on any mismatch:
  - read-back paragraph text from the DOCX bytes equals the plain-text
    projection of the lowered DocumentSpec, with a negative control (lowering
    itself is covered by the scenario tests);
  - section and footer inventory, with a negative control;
  - two compilations are byte-identical;
  - the output imports into the brownfield `docx-markdoc import` flow with
    every body paragraph anchored;
  - the `.txt` mirror is written from the read-back, never from the source;
  - an independent round trip (#1185): the DOCX re-imported through
    `docx-markdoc import` equals text read from the original Markdoc alone,
    never from the lowering or the DocumentSpec, with four negative controls
    and the mismatches recorded word by word.
- Optional PDF render through docx-markdoc's own `renderPlainPdf` (LibreOffice
  with a disposable profile, then `pdftotext -raw`). Missing tools report
  `not_run`; `--require-pdf` makes `not_run` a failure. A rendered PDF's text
  layer must match the source word for word; list labels, each page's
  footer and page number, and repeated table headers are modelled from the
  source, not excused by shape (#1185).
- A build that fails verification with a mismatch publishes nothing and
  leaves `<stem>.failed-verification.json`, named in the error; the next
  successful build removes it (#1185).
- Export library entry points: `lowerCreationMarkdoc(source, profile?)` returns
  a `DocumentSpec`, and `createDocumentFromMarkdoc(source, options?)` returns
  the DOCX, the text and the certificate.
- Template-backed `compile-greenfield` is unchanged.

## Impact

- Affected specs: `docx-markdoc` (ADDED requirements).
- Affected code: new `packages/docx-markdoc/src/create/*`, the CLI, and the
  `hardBreaks` option in `packages/docx-markdoc/src/markdocx/engine.ts`.
- Depends on `add-generation-document-defaults` (#1163),
  `add-generation-section-break-placement` (#1166), the upstreamed engine
  (#1172) and the plain-PDF render (#1173).
- Benchmark: a synthetic board-resolution document rendered by this command
  and by an equivalent python-docx renderer, scored on Word-clean, visual
  fidelity, style correctness, determinism, read-back equality, brownfield
  editability and source size.
- Non-goals: images, footnotes, cross-references, hyperlinks, a TOC, and
  inheriting a template's styles (use `compile-greenfield` for that).
