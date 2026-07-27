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

- **D1 — run-formatting flattening.** Each character of a paragraph is projected onto its `(bold, italic, underline)` triple. When a paragraph's text is unchanged but that projection changed, emphasis was flattened. The projection is compared rather than a multiset of runs so that a run boundary moving without changing any character's emphasis — which token splitting and rsid churn produce routinely — is not reported as loss.
- **D2 — emptied-but-retained paragraphs.** Paragraphs are matched on `w14:paraId` and flagged when they carried text before and carry none after, plus any empty paragraph still carrying `w:numPr`.

```bash
npm run check:docx-formatting-loss -- before.docx after.docx   # exit 1 on findings
npm run check:docx-formatting-loss -- --json before.docx after.docx
npm run test:docx-formatting-loss                              # unit tests + self-test
```

The tool emits counts, `w14:paraId` values, and element names, and never document text, so its output can be reported from a run over material that cannot be shared. The projection holds a digest of each paragraph's text rather than the text.

Two limits the output states rather than hides. Paragraphs without a `w14:paraId` cannot be matched at all; they are counted and named in the coverage line, and a zero finding does not cover them. Duplicate `paraId` values are dropped from the match set rather than resolved by last write, for the same reason. The emphasis key is deliberately narrow — bold, italic, underline — so losses confined to other run properties pass unreported.

## Pass Criterion

A diagnostic run is a pass only when all five hold. Anything short of all five is a fail and should be reported as one.

1. **Round-trip identity.** Accepting all revisions in the produced redline reproduces the revised document's extracted text exactly. Text inside `w:txbxContent` is the one documented boundary: text boxes are passed through opaquely and never carry redline markup, so their content is outside the compared projection. Note what this does *not* license. A text-box difference is not a benign residue to be waved through — `assertTextBoxContentUnchanged` fails closed and aborts the comparison before atomization when text-box content differs between the two sides (issue #647). Any residue confined to `w:txbxContent` therefore has to be named and explained, not absorbed into an expected-exception bucket.
2. **`PAGEREF` field count preserved** between input and output. This is how table-of-contents destruction shows up.
3. **Zero `w:ins` and `w:del` markers** in any clean output.
4. **Both formatting-loss detectors report zero.**
5. **`reconstructionModeUsed` reported** for both an `inplace` and a `rebuild` run — reported, not merely requested. The library defaults to `rebuild` while the MCP tool hardcodes `inplace` (`packages/docx-mcp/src/cli/commands/compare.ts`), so the same input can succeed through one entry point and abort through the other.

Report every detector count explicitly, including the zeros. A detector that prints nothing when it finds nothing cannot be told apart from a detector that never ran.

## Control Arm

Running only the suspect input establishes what happened to that input. It does not establish that the instrumentation can detect anything, which is what turns "no failure reproduced" from an ambiguous result into a trustworthy one.

`--self-test` is the standing control for the detectors themselves: it proves they fire on a known-bad pair and stay silent on a known-good one before any real run is believed. It runs in CI.

A comparison run needs its own control — a known-bad document put through the same harness. When a control has to be reconstructed rather than staged, treat the reconstruction as a hypothesis. If it does not reproduce the expected failure, record that as a negative result and stop. A control iterated until something finally breaks is not a control.

## Reproducing A Defect Outside The Original Document

When the document that triggered a defect cannot be shared, the repro is built in this order.

1. **Scrub in place.** Copy the document and replace text content with deterministic filler, leaving markup untouched — runs and run properties, `w:sdt`, fields and `w:instrText`, numbering, bookmarks, and section properties. Then confirm the scrubbed pair still reproduces. These defects live in structure, so structure has to survive the scrub.
2. **Synthesise from scratch** only when scrubbing fails to reproduce.

A synthetic that does not reproduce is not evidence that there is no bug. Hand-built fixtures have repeatedly passed on shapes that real documents fail. Report the outcome as "scrub reproduces, synthetic does not", which is itself a finding about how tightly the defect is coupled to real document structure.

Redaction is by inspection, not by category. Text-carrying payloads that are easy to miss: OOXML exception messages, which quote source text; bookmark names; and `w:instrText` field codes, which hold table-of-contents and `PAGEREF` strings.

## Build Hygiene

Gate on the build's exit status before trusting any result. A failed build leaves stale `dist` artifacts in place, and every measurement taken after it describes the previous build. When comparing two revisions of the library, confirm the two trees actually differ in the code under test before reading anything into the comparison — each worktree needs its own `npm install`, or `@usejunior/*` resolves to another tree's stale output.
