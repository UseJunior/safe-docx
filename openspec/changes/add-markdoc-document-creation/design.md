# Design: Create new Word documents from Markdoc

## Context

Three greenfield routes exist today:

- the per-matter python-docx renderer, which is not part of safe-docx;
- legal-explainer's private `markdocx` package, which lowers Markdoc onto
  docx-core and drives the published agreement templates; and
- template-backed `compile-greenfield`.

Only the first can build a resolution-style instrument. It is also not
deterministic, has no real numbering or tables, and has never been checked for
opening cleanly in Word.

`generateDocx` already provides each OOXML construct the renderer emits. This
change adds the authoring layer and the proof, and no new generator.

## Architecture

The creation grammar sits on the generic markdocx engine upstreamed from
legal-explainer (`add-markdocx-generic-engine`). There is one engine;
consumers differ only in what they plug in.

| Piece | File | Role |
|---|---|---|
| Validator | `create/validate.ts` | closed grammar, line-numbered errors, balanced fill-ins, all before rendering |
| Theme | `create/theme.ts` `CreationTheme` | named styles over document defaults; fill-in highlighting with nesting; one numbering instance per top-level list |
| Plugins | `create/theme.ts` `creationPlugins` | `center`, `legend` (no highlight), `signer`, `table`, inline `literal` |
| Driver | `create/lower.ts` | splits `{% section %}`; applies `{% page-break %}`; signer, legend and table neighbour rules; footers; meta; projection |

The engine already exposes every seam this needs except one. A Markdoc hard
break renders as a space under its lenient contract, so the additive
`hardBreaks: 'line'` option makes hard breaks real line breaks (list items
included) without changing the default. The one-line forms
(`{% center %}x{% /center %}` alone in a paragraph) reach the plugins through
the engine's `transformBlock` hook, which also renders block quotes and
allocates each top-level list's numbering instance.

## Goals / Non-Goals

### Goals

- One command turns a `.mdoc` into `.docx`, `.txt`, an optional `.pdf`, and a
  certificate.
- The grammar is closed and fails loudly. Unknown nodes and tags, and leftover
  pseudo-HTML, fail with a line number and a migration hint. Nothing is
  silently dropped.
- Formatting comes from named paragraph styles over document defaults, not from
  direct formatting on each run, so the output reads as a normal Word document
  and stays editable.
- Output bytes are a pure function of the source and the profile.
- A created v1 is a valid brownfield source: `docx-markdoc import` anchors every
  body paragraph.

### Non-Goals

- Images, footnotes, cross-references, hyperlinks, fields other than PAGE, and
  a TOC.
- Projecting into an existing template's styles. `compile-greenfield` keeps
  that job.
- Moving legal-explainer's `markdocx` or its agreement adapter into safe-docx.
  Its generic engine could later call `lowerCreationMarkdoc`.

## Grammar

Frontmatter is optional. It holds `key: value` lines from a closed key set,
read without a YAML dependency:

| Key | Meaning |
|---|---|
| `title`, `author` | core properties |
| `date` | ISO date for core properties. The default is the fixed epoch `2006-01-01T00:00:00Z`; the build never reads the clock. |
| `footer` | the first section's footer text |
| `page-numbers` | `true` puts a centred PAGE field in the first section's footer |

Blocks:

| Source | Output style | Formatting (default profile) |
|---|---|---|
| `# Text` | `Title` | centred, bold, 14pt, keep-with-next |
| `## Text` | `Heading1` ("heading 1") | bold, 10pt before, keep-with-next |
| `### Text` | `Heading2` ("heading 2") | bold italic, keep-with-next |
| paragraph | `BodyText` | justified |
| `> text` | `Quote` | 0.5" left and right, justified |
| `1.` list, nested up to 3 levels | `ListParagraph` + numbering | `1.` / `(a)` / `(i)`. Each top-level list is its own numbering instance and starts at its first marker. |
| `-` list | `ListParagraph` + bullet numbering | |
| `{% table %}` | `TableText` in each cell | single borders, header row bold and repeated, equal widths or `widths="30,70"` |
| `{% center %}…{% /center %}` | `Centered` | centred |
| `{% legend %}…{% /legend %}` | `Legend` | centred, italic, 24pt before; the previous block keeps with next; no fill-in highlight |
| `{% signer name="…" date="…" /%}` | `Signature` | see below |
| `{% page-break /%}` | — | page-break-before on the next block |
| `{% section footer="…" page-numbers=true /%}` | — | next-page section break; see Sections |

Inline:

- `**bold**`, `*italic*` (they may nest), and a hard break (a line ending in
  `\`).
- Soft breaks become one space.
- A link, image, code span, HTML or unknown inline tag is an error.

Fill-ins: after parsing, every character from a `[` to its matching `]`
(nesting allowed, the brackets included) gets yellow highlight. Bracket depth
carries across bold and italic boundaries. An unbalanced bracket is an error,
except inside `{% legend %}` or the inline `{% literal %}…{% /literal %}` tag,
where nothing is highlighted.

Signer:

- One paragraph: a 30-underscore signature line, a line break, `name`, then
  (when `date` is present) a tab to a left stop at 4.25" and `date`.
- 42pt before the first signer of a consecutive run and 30pt before each later
  one. Vertical space never comes from empty paragraphs.
- Keep-lines on the signer. The preceding non-signer block gets
  keep-with-next.

Sections:

- `{% section /%}` ends the current section with a next-page break. The
  `sectPr` sits on the last paragraph, so no empty paragraph is added.
- A `footer` or `page-numbers` attribute gives the new section its own
  unlinked footer: centred italic text, then a centred PAGE line.
- With neither attribute the footer stays linked to the previous section, as
  in Word.

Pseudo-HTML migration errors: a paragraph whose whole text is `<center>…`,
`<legend>…`, `<signer>…` or `<!-- … -->` fails with `LEGACY_MARKUP` and names
the Markdoc tag to use.

## House-style profile

The profile is plain JSON. Every field is optional and merges over the default:

```json
{
  "font": "Times New Roman",
  "sizePt": 11,
  "spacingAfterPt": 8,
  "lineSpacing": 1.15,
  "marginsIn": 1,
  "titleSizePt": 14,
  "signatureTabIn": 4.25
}
```

`font` lands on all four `w:rFonts` channels through `DocumentSpec.defaults`.

## Verification certificate

Every `create` build runs these checks and refuses to write outputs if any
fails:

1. **Package:** `checkGeneratedPackage` reports no issues.
2. **Determinism:** a second in-process compilation is byte-identical.
3. **Read-back:** the DOCX body is read back from the package bytes,
   paragraph by paragraph, in document order including table cells. `w:br`
   becomes `\n` and `w:tab` becomes `\t`; numbering text is not included. It
   must equal the plain-text projection of the lowered DocumentSpec, which
   proves emission and packaging. Lowering itself is pinned by the scenario
   tests. In that projection:
   - markup is stripped and brackets are kept;
   - a signer becomes `line\nname\tdate`;
   - layout tags produce nothing.

   A negative control changes one character of the expected projection, and
   the comparator must report a mismatch.
4. **Footers:** section count, each section's linked or unlinked state, and
   each footer's text (`<PAGE>` for the field) equal the projection, with a
   negative control.
5. **Brownfield editability:** `importDocxToMarkdoc` on the output anchors
   every non-empty body paragraph: the anchored count equals the non-empty
   read-back paragraph count. (Import does not anchor empty paragraphs; the
   only empty paragraph creation emits is the break after a table that ends a
   section.)
6. **Mirror:** `<stem>.txt` is written from the read-back, re-read and
   compared.
7. **PDF (optional):** render with LibreOffice in a disposable profile and run
   `pdftotext`. The PDF must be non-empty and must contain the first and last
   non-empty paragraphs (the last truncated to 80 characters when longer than
   120) and every footer text, compared with whitespace collapsed. Missing
   tools report `not_run`.

`<stem>.verification.json` records the source, profile and output SHA-256 hashes,
each check's outcome, the block inventory and the section inventory.

## CLI

```text
docx-markdoc create <document.mdoc> <output-dir>
  [--style-profile profile.json] [--no-pdf] [--require-pdf] [--replace]
```

- The output directory may already exist.
- Each output path must be new unless `--replace` is given. `--replace` is
  meant for rebuild loops in a matter's `outbound/draft`.
- Outputs are written to temporary siblings and renamed only after every
  check passes.

## Risks

- **Literal brackets.** A literal `[` in prose is read as a fill-in. Markdoc
  unescapes `\[` to plain text, so an escape cannot opt out. The inline
  `{% literal %}…{% /literal %}` tag opts its content out of fill-in
  detection, and a legend is never highlighted.
- **Numbering restarts.** Each top-level list gets its own numbering
  definition because docx-core has no `w:lvlOverride`. That is valid OOXML,
  but it multiplies `abstractNum` entries.
