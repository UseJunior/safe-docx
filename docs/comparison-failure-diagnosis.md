# Comparison Failure Diagnosis

A comparison run that produces no visible error is not the same as a comparison run that succeeded. Extracted text can come back byte-identical, the round-trip can report success, and the output can open cleanly in Word while a defect a reader would notice on the first page is still present. This page states the failure classes a diagnosis has to distinguish, the criterion a run has to clear before it counts as a pass, and the evidence a negative result needs to be believable.

## Failure Classes

| Class | What it looks like | How it is caught |
|---|---|---|
| Throw | `OpaquePassthroughError`, a field-structure validation error, or a round-trip safety abort | The stack trace, plus the offending node's ancestor chain |
| Phantom markup | Unchanged text struck and reinserted — `w:delText` and `w:t` carrying the same characters | Scan the output for adjacent `w:delText` / `w:t` pairs with matching text |
| Silent content loss | Content present in the input and absent from the output | Round-trip identity of extracted text |
| Degraded redline | Comparison succeeds and the redline is unusable | Inspection |
| Formatting loss | Character formatting destroyed while every character survives | [The structural detectors below](#detecting-formatting-loss) |

The last class is the one that hides. It passes text-level checks by construction, because no text changed. Two shapes have been observed:

- A replacement whose span crosses a run boundary collapses the boundary and drops bold or italic from the affected span, so a defined term loses its emphasis.
- Replacing a block leaves paragraph shells behind. An empty body paragraph renders as a blank line. An empty list paragraph that kept its `w:numPr` renders an orphan numbered label, which a reader sees and a text diff does not.

## Detecting Formatting Loss

`scripts/check_docx_formatting_loss.mjs` compares a before/after `.docx` pair and reports two detectors:

- **D1 — run-formatting flattening.** Each character of a paragraph is projected onto its *effective* formatting tuple — the supported toggle properties, underline, highlight, font, size, color — resolved through `word/styles.xml` by docx-core's `extractEffectiveRunFormatting`, the same resolver the document views use. When a paragraph's text is unchanged but that projection changed, formatting was lost. The projection is compared rather than a multiset of runs so that a run boundary moving without changing any character's formatting — which token splitting and rsid churn produce routinely — is not reported as loss. Resolving rather than reading declarations means editing a style *definition* while every reference stays put is caught, emphasis inherited from a paragraph style is visible, and replacing a style reference with equivalent direct properties is correctly not reported — a reader sees the same page either way.
- **D2 — emptied-but-retained paragraphs.** Paragraphs are matched on `w14:paraId` and flagged when they carried content before and carry none after, including the case where the emptied paragraph kept its `w:numPr`. Both halves are transitions: a paragraph that was already empty is a property of the input, not damage the comparison caused, and is reported separately as hygiene. "Empty" means no text *and* no renderable payload, so an image-only or field-only paragraph does not count as empty.

```bash
npm run build                                                  # the script consumes the built @usejunior/docx-core
npm run check:docx-formatting-loss -- before.docx after.docx   # 0 clean, 1 findings, 2 inconclusive
npm run check:docx-formatting-loss -- --json before.docx after.docx
npm run test:docx-formatting-loss                              # unit tests + self-test
```

The build step is a real dependency, not hygiene: formatting resolution comes from the built workspace package so the detector and the library cannot drift, and an unbuilt tree fails at import with instructions rather than running against stale behavior.

Both inputs must be clean documents. The tool refuses a redline, because in a document carrying `w:del` the deleted text is still present and "empty" does not mean what D2 assumes.

**Coverage is enforced, not merely reported.** The match key is the tool's sharpest edge: `reconstructionMode: 'rebuild'` emits output carrying no `w14:paraId` at all, so every paragraph fails to match, every detector reports zero, and the run reads as a clean pass having inspected nothing. Coverage below 95% of the larger side's paragraph count is therefore reported as `INCONCLUSIVE` and exits 2. Use `--min-coverage` to move the floor once you have decided what the gap means. In practice an `inplace` output keeps its ids; a real contract pair measured 97%, the shortfall being duplicate ids.

What the detectors do not see, stated rather than hidden:

- **D1 resolves what the resolver resolves.** `extractEffectiveRunFormatting` layers direct `w:rPr`, the `w:rStyle` chain, the paragraph mark's `w:rPr`, and the paragraph style's `basedOn` chain, each property independently. Theme fonts and theme colors resolve through `word/theme/theme1.xml`, including `themeTint` and `themeShade`; a missing theme part retains direct font/color fallbacks. It does not reach `w:docDefaults`, table-style run properties, or numbering-level `rPr`. Toggle properties use style-level parity and absolute direct-formatting semantics; D1 includes the full supported toggle set in its character projection. Underline is reduced to on/off, so an underline style-to-style change (single to dotted) is no longer a finding — the declared-properties projection this replaced ([#684](https://github.com/UseJunior/safe-docx/issues/684)) caught that corner but missed every style-carried loss. Color hex compares case-insensitively.
- **D1 requires identical text.** Formatting loss that co-occurs with a text edit in the same paragraph is out of reach.
- **Paragraphs without a `w14:paraId`, and paragraphs sharing a duplicate one, are not compared.** Duplicates are dropped from the match set rather than resolved by last write; both are counted in the coverage line.
- **A side with no `word/styles.xml` degrades to direct properties only** for that side, with a note on stderr. Real documents always carry the part; the note exists so the degradation is never silent.

The tool emits counts, `w14:paraId` values, and element names in its detector reports, and the projection holds a digest of each paragraph's text rather than the text, so results from a run over material that cannot be shared are still reportable. Usage and IO errors do echo the paths you passed in.

## Pass Criterion

A diagnostic run is a pass only when all five hold. Anything short of all five is a fail and should be reported as one.

1. **Round-trip identity.** Accepting all revisions in the produced redline reproduces the revised document's extracted text exactly. Text inside `w:txbxContent` is the one documented boundary: text boxes are passed through opaquely and never carry redline markup, so their content is outside the compared projection. Note what this does *not* license. A text-box difference is not a benign residue to be waved through — `assertTextBoxContentUnchanged` fails closed and aborts the comparison before atomization when text-box content differs between the two sides (issue #647). Any residue confined to `w:txbxContent` therefore has to be named and explained, not absorbed into an expected-exception bucket.
2. **`PAGEREF` field count preserved** between input and output. This is how table-of-contents destruction shows up.
3. **Zero `w:ins` and `w:del` markers** in any clean output.
4. **Both formatting-loss detectors report zero, on a run that was conclusive.** An `INCONCLUSIVE` result is not a pass, and neither is a zero count taken from one. Rebuild output cannot satisfy this criterion by paraId matching alone.
5. **`reconstructionModeUsed` reported** for both an `inplace` and a `rebuild` run — reported, not merely requested. The library leaves `reconstructionMode` unset by default, while the MCP tool passes `DEFAULT_RECONSTRUCTION_MODE`, which is `inplace` (`packages/docx-mcp/src/tools/comparison_defaults.ts`). The `compare` CLI accepts an explicit `mode` and falls back to the same default. The same input can therefore succeed through one entry point and abort through another, and `inplace` can silently fall back to `rebuild` — which is why the mode that ran, not the mode requested, is what gets recorded.

Report every detector count explicitly, including the zeros. A detector that prints nothing when it finds nothing cannot be told apart from a detector that never ran.

## Control Arm

Running only the suspect input establishes what happened to that input. It does not establish that the instrumentation can detect anything, which is what turns "no failure reproduced" from an ambiguous result into a trustworthy one.

`--self-test` is the standing control for the detectors themselves: it proves they fire on a known-bad pair and stay silent on a known-good one before any real run is believed. It runs in CI. It is a synthetic control over the detector logic, which is not the same as a control over the comparison engine — and this page's own warning about synthetic fixtures applies to it.

A comparison run needs its own control — a known-bad document put through the same harness. When a control has to be reconstructed rather than staged, treat the reconstruction as a hypothesis. If it does not reproduce the expected failure, record that as a negative result and stop. A control iterated until something finally breaks is not a control.

**No independently occurring document-level control is currently available for
the run-split abort.** A 2026-07-27 reconstruction attempt for
[#693](https://github.com/UseJunior/safe-docx/issues/693) scrubbed the public
NVCA indemnification agreement in place, preserving its package structure and
109 `w:instrText` field instructions. The revised side changed one character of
a 17-character scrubbed text run and split that run in two. The public
`compareDocuments` entry point succeeded in both requested modes: `inplace`
reported `reconstructionModeUsed: 'inplace'`, and `rebuild` reported
`reconstructionModeUsed: 'rebuild'`.

Later review established the limit of that result: the chosen run followed the
end of a `SEQ` field and therefore sat outside the field range. Rebuild still
correlated all 108 captured `REF` boundaries, but success proved only that the
mutation perturbed none of them. Because the split landed outside every opaque
descriptor, their stability says nothing about the guard's sensitivity to a
run split. The authoritative comparison is in
`packages/docx-compare/src/baselines/atomizer/opaquePassthrough.ts`.

An equivalent pure run split deliberately placed inside a supported `REF` field
result does make `rebuild` throw the expected `OpaquePassthroughError` while
`inplace` succeeds. That targeted probe validates the guard path, but it is not
a control for the original real-world abort: its failure was manufactured by
placing the split inside a construct known to be guarded.

No fixture was therefore committed. Until an independently occurring known-bad
pair can be staged and pinned through `compareDocuments`, a diagnostic run can
prove the detector self-tests ran, but it cannot prove that its comparison
harness can surface this abort. The reconstruction retained field codes and
bookmark names only because its source was a public standard form; the same
scrub would not be sufficient redaction for a confidential document.

## Reproducing A Defect Outside The Original Document

When the document that triggered a defect cannot be shared, the repro is built in this order.

1. **Scrub in place.** Copy the document and replace text content with deterministic filler, leaving markup untouched — runs and run properties, `w:sdt`, fields and `w:instrText`, numbering, bookmarks, and section properties. Then confirm the scrubbed pair still reproduces. These defects live in structure, so structure has to survive the scrub.
2. **Synthesise from scratch** only when scrubbing fails to reproduce.

A synthetic that does not reproduce is not evidence that there is no bug. Hand-built fixtures have repeatedly passed on shapes that real documents fail. Report the outcome as "scrub reproduces, synthetic does not", which is itself a finding about how tightly the defect is coupled to real document structure.

Redaction is by inspection, not by category. Text-carrying payloads that are easy to miss: OOXML exception messages, which quote source text; bookmark names; and `w:instrText` field codes, which hold table-of-contents and `PAGEREF` strings.

## Build Hygiene

Gate on the build's exit status before trusting any result. A failed build leaves stale `dist` artifacts in place, and every measurement taken after it describes the previous build. When comparing two revisions of the library, confirm the two trees actually differ in the code under test before reading anything into the comparison — each worktree needs its own `npm install`, or `@usejunior/*` resolves to another tree's stale output.
