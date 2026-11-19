# Greenfield parity benchmark: `docx-markdoc create` vs python-docx

This benchmark renders one synthetic board consent two ways:

- with `docx-markdoc create`, from `resolution.mdoc`;
- with a python-docx renderer, from `resolution.legacy.mdoc` using the
  pseudo-HTML conventions of the per-matter renderers it replaces.

It then scores both outputs on the same axes. Everything here is synthetic.

`python_docx_baseline.py` is a clean-room renderer written from a generic
feature list:

- house style, title and headings, centred text and quotes;
- lettered sub-paragraphs, line and page breaks;
- legends, signer blocks, and next-page sections with unlinked footers;
- a PAGE field, bracketed fill-ins, bold and italic.

It also gets python-docx's native tables, so the baseline is python-docx at
its best rather than a strawman. Clause numbers stay literal text because
python-docx has no numbering API.

## Run

```bash
npm run build -w @usejunior/docx-markdoc
node packages/docx-markdoc/benchmarks/python-docx-parity/run.mjs <out-dir> \
  [--word-probe ~/.claude/skills/word-fidelity-check/probe.sh]
```

Requirements:

- `uv`, which fetches `python-docx==1.2.0` for each run;
- LibreOffice and `pdftotext` for the PDF axis;
- `xmllint` for the schema axis;
- Word for Mac for the optional Word axis.

A missing tool marks its axis `not_run`, and a Word probe that cannot get a
read is marked `indeterminate`. Neither is scored as a pass. The out-dir holds
both DOCX files, their PDFs, page PNGs for visual review, and `results.json`.

## Axes

| Axis | How it is scored |
|---|---|
| Word opens clean: XSD | `scripts/check_emitted_document_schema.mjs` (transitional WML XSD) |
| Word opens clean: Word for Mac | `word-fidelity-check` probe; only a repair/recovery dialog is a fail |
| PDF fidelity | LibreOffice render; every read-back paragraph appears in order, page 1 shows the page number, page 2 shows the signature-page footer |
| Style correctness | 8 OOXML checks: see below |
| Determinism | two builds 2.5 s apart are byte-identical |
| Read-back text equality | paragraphs read back from the DOCX equal the source projection |
| Brownfield edit | `docx-markdoc import`, then two `change` edits (in-run, and next to a fill-in), must compile to a redline with only that insertion |
| Authoring effort | non-blank source lines + renderer lines a matter must carry |

The 8 style checks:

1. house font pinned once at document level on all four `w:rFonts` channels;
2. no direct fonts on body runs;
3. headings use Word heading styles;
4. real `w:numPr` numbering and no literal numbers;
5. no empty spacer paragraphs;
6. fill-ins highlighted;
7. signer dates aligned by a tab stop;
8. the table header row repeats.

## Latest results (2026-10-08)

| Axis | safe-docx `create` | python-docx |
|---|---|---|
| Word opens clean: XSD | pass | pass |
| Word opens clean: Word for Mac | pass¹ | pass¹ |
| PDF fidelity (LibreOffice) | pass | pass |
| Style correctness | pass (8/8) | partial (4/8) |
| Determinism (byte-identical rebuild) | pass | fail |
| Read-back text equality | pass | pass |
| Brownfield edit → clean redline | pass² | fail³ |
| Authoring effort (source + renderer lines) | 37 + 0 | 27 + 191 |

1. **Word for Mac:** from the 2026-10-07 run. The engine-based build produces
   byte-identical output (same SHA-256) to that run's build. On 2026-10-08,
   Word held ghost document objects and the probe could not load any file, so
   the rerun was `indeterminate` for both outputs.
2. **safe-docx brownfield:** the in-run edit needs no hint. The edit right
   before the `[Number]` fill-in needs the documented `format-source` hint;
   draft #1168 would remove that need.
3. **python-docx brownfield:** python-docx writes `<w:t>…</w:t><w:br/>` in one
   run, and docx-compare turns an edit in that run into a whole-sentence
   delete and reinsert (#1169). The boundary edit behaves as in note 2.

python-docx loses style points on four checks:

- per-run fonts;
- no heading styles;
- literal `1.` / `(a)` numbers;
- a table header that does not repeat.

**Where safe-docx still loses:** the source alone is longer (37 vs 27 lines),
mostly because Markdoc table syntax is more verbose than a pipe table. It wins
on total effort only once the 191-line renderer each matter carries is
counted.
