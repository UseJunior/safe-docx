# Change: Fail closed when a comparison input already contains tracked changes

## Why

`compareDocuments` accepts an input that already carries revision markup (`w:ins`/`w:del`/moves/`*PrChange`)
without warning, layers the comparison author's markup over it, and exits 0 with normal stats. The output keeps
**two revision authors** in `word/document.xml` — the comparison author plus the tracked input's author — and,
edit-density permitting, directly nested revision elements (`w:ins` inside `w:ins`). Microsoft Word refuses to open
that file ("Word found unreadable content"). Reproduced at HEAD for issue #742: `compare(clean, tracked)` returned
`{"insertions":2,"deletions":2,...}`, exit 0, output authors `["Comparison","Original Author"]`, with nested
`w:ins`-in-`w:ins`; the transitional-schema gate passes the file, so the corruption is behavioral, not schema-visible.
An independent Codex premise check confirmed both the missing guard and the runtime reproduction.

A separate 520-document SHA-pinned corpus differential independently confirmed the mechanism: in **rebuild** mode
the comparison unwraps pre-existing tracked changes into bare `w:delText` outside any `w:del` wrapper — precisely
the Word-unreadable shape — while **inplace** passes the markup through, still merging two authors' revision trees
into one document. The guard therefore refuses tracked inputs in both reconstruction modes, at the shared boundary.

Given the current behaviour is silent corruption, failing loudly is strictly better than a clever default. This
change intentionally rejects inputs the comparison previously accepted — a public contract change, hence this
proposal.

## What Changes

- **BREAKING**: `compareDocuments` and the directly exported `compareDocumentsAtomizer` SHALL refuse to compare
  when either operand already contains tracked-changes markup, throwing a typed recoverable
  `TrackedInputRevisionError` (exported from the package root, following the `UnsupportedTextBoxRevisionError`
  precedent) that names the offending operand (`original` vs `revised`), the package part, and the markers found.
- The scan covers `word/document.xml` plus every revision story part — footnotes, endnotes, comments, the glossary
  document, and each numbered header/footer part via `enumerateRevisionStoryPartPaths` — and detects the four
  content markers (`w:ins`, `w:del`, `w:moveFrom`, `w:moveTo`), the six property-change records (`w:rPrChange`,
  `w:pPrChange`, `w:sectPrChange`, `w:tblPrChange`, `w:trPrChange`, `w:tcPrChange`), the cell-topology records
  (`w:cellIns`, `w:cellDel`, `w:cellMerge`), and `w:numberingChange` — the last four added after peer review
  execution-proved they passed the ten-name scan and survived comparison with their prior author. Row-level
  markers (`w:trPr > w:ins|w:del`) share those local names and trip the guard. Range-boundary markers
  (`w:*RangeStart`/`End`, `w:customXml*Range*`) are classified non-triggers: no author-bearing content of their
  own, content-bearing moves are caught via their wrappers, and an isolated range pair is dropped by the
  comparison rather than passed through.
- One guard at the lowest public comparison boundary (`compareDocumentsAtomizer`), not one per surface: the MCP
  tool and both CLIs funnel through it, so surfaces only *map* the typed error rather than re-scanning.
  - `compare_documents` (MCP) maps the error to a distinct `INPUT_HAS_TRACKED_CHANGES` code — never the catch-all
    `COMPARE_ERROR` — with a part-aware recovery hint: `accept_changes` where it applies, but a header/footer
    detection instead directs the caller to produce a fully accepted/rejected copy, because `accept_changes`
    does not cover headers or footers and recommending it there would loop.
  - Both CLIs (`docx-comparison`, `safe-docx compare`) propagate the error to their existing entry-point handler:
    nonzero exit, message naming the offending operand. No CLI code change is required.
- Missing story parts are skipped. Parts the scan cannot parse are also skipped **by this guard**: malformed-part
  failures belong to the package-level ancillary safety boundary (`AncillaryStorySafetyError` /
  `NOTE_PART_XML_INVALID`), whose precise typed diagnostics the preparatory scan must not pre-empt — the same rule
  `textBoxRevisionSafety` applies to its own preparatory scan.
- Engine behaviors that only arise for pre-tracked inputs (original-insertion provenance restoration, revised-side
  insertion-collision promotion, preserved-move identity seeding, pre-existing-wrapper bookmark splitting,
  canonical-emission round-trips, [ADV-COMPARE-MODE-PRESERVATION-01]'s mode characterization) remain implemented
  and tested through `compareDocumentsAtomizerUnguarded`, an explicitly named unguarded seam that is NOT exported
  from the package root (a test pins its absence — peer review demonstrated that a root export is a live public
  bypass). docx-compare tests import it from the pipeline module; docx-core integration tests import it through
  the package's dist subpath, which their vitest config aliases back to the same source module graph the root
  alias uses (a relative source import violates that package's tsc `rootDir`). A future accept-on-ingest opt-in
  would route there after projecting its inputs; until then the supported boundary refuses.

## Impact

- Affected specs: `docx-comparison` (ADDED: `Tracked-Input Comparison Refusal`) and `mcp-server`
  (ADDED: `Tracked-Input Refusal in the Compare Documents Tool`). Both are ADDED rather than MODIFIED: no deployed
  requirement in either capability makes any promise about comparison-input validation today, so there is nothing
  to modify without inventing prior text the archiver would then overwrite.
- Affected code: `packages/docx-compare/src/baselines/atomizer/trackedInputRevisionSafety.ts` (new),
  `packages/docx-compare/src/baselines/atomizer/pipeline.ts` (guard call + unguarded seam),
  `packages/docx-compare/src/index.ts` (exports), `packages/docx-mcp/src/tools/compare_documents.ts` (error
  mapping).
- Callers that previously compared tracked inputs now get a typed error instead of a Word-unreadable file. That is
  the point of the change; the prior output was corrupt. MCP session-mode comparison of a document that was opened
  with pre-existing tracked changes is likewise refused.
- Existing tests that deliberately drove pre-tracked fixtures through the public entry to pin engine internals now
  use the unguarded seam, with per-site comments citing this change. Their assertions are unchanged.
- `compare(clean, clean)` and every clean-input comparison are byte-for-byte unaffected apart from one additional
  scan per operand.
- Refs #742.

## Out of scope

- An `--allow-tracked-input` opt-in and accept-on-ingest semantics (re-authoring emitted revisions to the
  comparison author, matching Word's own compare) — the issue sketches this as a follow-up; the unguarded seam is
  where it would attach.
- Nested-revision semantics.
- Removing or regenerating the two checked-in Word-unreadable sample outputs
  (`packages/docx-core/src/testing/outputs/atomizer_redline.docx`, `typescript_redline.docx`): both are cited as
  provenance by `fieldComparisonSemantics.test.ts` and `openspec/changes/add-scoped-field-evaluation/design.md`,
  so that cleanup belongs to its own change.
