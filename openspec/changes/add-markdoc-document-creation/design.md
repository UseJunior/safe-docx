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
| Validator | `create/validate.ts` | closed grammar, line-numbered errors, fill-in markup (and balanced brackets under `fill-ins: brackets`), all before rendering |
| Theme | `create/theme.ts` `CreationTheme` | named styles over document defaults; `{% fill %}` highlighting (or bracket highlighting when opted in); one numbering instance per top-level list |
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
- Soft breaks become one space. They are turned into text before rendering,
  so a fill-in that wraps across source lines stays highlighted through the
  space.
- Inline HTML is rejected unless it is wrapped in `{% literal %}`, as are
  Markdoc parse errors such as an unclosed tag.
- A nested ordered list must start at 1.
- A link, image, code span, HTML or unknown inline tag is an error.

Fill-ins (#1184): `{% fill %}Effective Date{% /fill %}` is the only fill-in
markup. It renders `[Effective Date]` with the renderer-supplied brackets and
the text highlighted yellow. Fill-ins may nest and may sit inside bold or
italic text. A signer name can hold one when the name is the tag's content
rather than `name="…"`. Bare brackets are literal text, balanced or not:
quoted alterations (`[t]he`), `[sic]` and cross-references are common in
legal prose, and silently highlighting real text as a blank is worse than an
unhighlighted blank. Frontmatter `fill-ins: brackets` restores the v0.24 rule
for sources written that way: every character from a `[` to its matching
`]` is highlighted, depth carries across bold and italic boundaries, an
unbalanced bracket is an error, and `{% literal %}` and legends are exempt.
Raw brackets inside a `{% fill %}` count in that mode as well (the brackets the
tag adds do not), so a bracketed blank that crosses a tag boundary ends at its
own `]` in both the validator and the renderer.
Alternatives rejected: `[[…]]` (collides with the `[[Term]]` defined-term
convention of the upstream agreement renderer) and `{{…}}` (reads as a
template variable).

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
  unlinked footer: centred italic text, then a centred PAGE line. An explicit
  `page-numbers=false` with no `footer` gives it an unlinked empty footer.
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

Every `create` build runs these checks and publishes no output if any
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
   every paragraph with text and every table-cell paragraph, including blank
   cells. The anchored count must equal that count. Import does not anchor an
   empty body paragraph, and the only one creation emits is the break after a
   table that ends a section.
6. **Mirror:** `<stem>.txt` is written from the read-back, re-read and
   compared.
7. **Independent round trip (#1185):** checks 3 and 4 compare the DOCX with
   the projection of the lowered DocumentSpec, so a lowering bug that drops
   content from both passes them. This check takes its expected text from
   the original Markdoc only (`create/oracle.ts`, its own AST walk; it never
   calls the validator's renderer, the lowering, the theme or the engine) and
   its actual text from `docx-markdoc import` of the created DOCX. Body
   paragraphs and each section's footer paragraphs are compared as
   sequences, with a Myers alignment, after Unicode NFC and whitespace
   collapsing only (no case, punctuation or duplicate folding); empty
   paragraphs are dropped on both sides. A footer page-number field matches
   any decimal number. Each mismatch is recorded as `missing`, `extra` or
   `changed`, with its source line and, for `changed`, the missing and extra
   word spans with four words of context. Four negative controls must each
   be detected: a deleted word, paragraph, table cell and footer text
   (`not applicable` when the source has none). The oracle encodes the
   grammar's layout contract (a signer is a 30-underscore line, a break, the
   name, a tab and the date; a fill renders inside brackets; list numbers are
   not paragraph text).
8. **PDF (optional):** render with LibreOffice in a disposable profile and run
   `pdftotext -raw`. The PDF must be non-empty and must contain the first and
   last non-empty paragraphs (the last truncated to 80 characters when longer
   than 120) and every footer text, compared with whitespace collapsed.
   Missing tools report `not_run`.
9. **PDF words (#1185):** when the PDF passes check 8, its text layer is
   aligned word by word (NFKC, whitespace split) with the source text. `-raw`
   is content-stream order: LibreOffice writes each page's footer first, then
   the body in document order (table cells row by row even when they wrap, a
   justified line ending in a manual break kept whole); the default
   reading-order mode reads a table column by column. Every piece of generated
   text is modelled from the source, never excused by its shape:
   - **list labels** are expected words, computed from the grammar's numbering
     (`1.`, `(a)`, `(i)` by depth; top-level lists start at their first
     marker; bullets `•`, `◦`, `▪`), so a generated `1.` cannot stand in for a
     deleted literal `1.`;
   - **page breaks are explained, not guessed:** between two consecutive
     aligned source words, each page that starts there must start at some
     point in the source between them, including inside wordless content
     such as empty table rows. A start fixes what the page must show first:
     the effective footer (inherited when a section declares none) and page
     number of its section, the table header LibreOffice repeats when a
     table continues across the break, and the source words at the top of
     the page. Sections start on new pages, so every section change must be
     a page start, and a page can hold only one section. Two observed
     LibreOffice behaviours are assumed: a header row is never left alone
     at a page bottom, and a table's last row can spill its empty remainder
     onto the next page, repeating the header there (that page stays in the
     table's section). The check passes only when every start that fits
     explains the same source words; if none fits, or fitting starts
     disagree, it fails (`footerMismatches` or `unverifiedTableHeaders`), so
     generated header or footer text can never stand in for a missing
     source word or a wrong footer. A layout the text cannot disambiguate
     (a table with empty trailing rows followed by a table with the same
     header; two identically headed tables back to back at a page start)
     fails even when the PDF is right.

   Any other missing or extra word fails with `CREATION_PDF_WORDS_MISMATCH`;
   texts too different to align within 2,000 edits fail as `over-budget`.
   The recorded `limitations` string states these assumptions and the
   layouts that fail for ambiguity.

`<stem>.verification.json` records the source, profile and output SHA-256 hashes,
each check's outcome, the block inventory and the section inventory. The PDF
verdict is recorded without its per-page text, with the word comparison
under `pdf.words`.

### Failure report

A failed check that found a mismatch (`CREATION_VERIFICATION_FAILED`,
`CREATION_PDF_FAILED` with a rendered PDF, `CREATION_PDF_WORDS_MISMATCH`)
publishes nothing and leaves existing outputs untouched, including an earlier
`<stem>.verification.json`. It writes `<stem>.failed-verification.json`
(kind `markdoc-create-failure`, the error code and message, `published:
false`, and the failing certificate or PDF verdict with every mismatch),
staged and renamed into place under the stem lock, so it never writes through
a symlink. The error message names its path (or says why it could not be
written). The next failed build replaces it; the next successful build
removes it. Missing PDF tools under `--require-pdf` are not a mismatch and
leave no report, and validation errors are reported with their line number
only.

## CLI

```text
docx-markdoc create <document.mdoc> <output-dir>
  [--style-profile profile.json] [--no-pdf] [--require-pdf] [--replace]
```

- The output directory may already exist.
- Each output path must be new unless `--replace` is given. `--replace` is
  meant for rebuild loops in a matter's `outbound/draft`.
- Outputs are staged in a private directory inside the output directory and
  published as one transaction after every check passes:
  - each existing target, including a stale artifact this build does not
    produce, is first moved to a backup;
  - each new file is then placed with an exclusive hard link, so a file that
    appears mid-build is never overwritten;
  - any failure restores the backups, and a rollback removes only files whose
    inode, when checked, is that of the file this run staged. Ownership is
    read from the private staged file before linking. Check-then-unlink is
    not atomic, so the guarantee covers cooperating create runs (serialized
    by the lock) but not an unrelated program racing that instant;
  - an original that cannot be restored is moved to a named
    `.<stem>.create-recovery-…` directory instead of being deleted, and the
    error reports every recovery problem;
  - an exclusive `.<stem>.create.lock` file serializes runs on the same output
    directory and stem. If writing the lock fails, it is closed and removed.
- Input and output paths are compared canonically (realpath and inode), so a
  symlinked directory or a hard link cannot alias an input.

## Risks

- **Fill-in markup is verbose.** `{% fill %}…{% /fill %}` costs more
  characters than `[…]`; that is the price of never misreading literal
  brackets. `fill-ins: brackets` remains for sources that want the terse
  form and contain no literal brackets.
- **Numbering restarts.** Each top-level list gets its own numbering
  definition because docx-core has no `w:lvlOverride`. That is valid OOXML,
  but it multiplies `abstractNum` entries.
