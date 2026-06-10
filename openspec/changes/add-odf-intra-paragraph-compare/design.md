# Design — ODF intra-paragraph tracked changes

## Oracle decision log (LibreOffice 25.x authoring, 2026-06-10)

Method: `.tmp/odf-inline-oracle/run_author_oracle.sh` — a throwaway clone of the
`reference_libreoffice_macos_oracle` recipe. Each scenario loads a flat-ODF fixture headlessly,
sets `RecordChanges = True`, performs cursor edits (`createTextCursorByRange` + `goRight` +
`setString`), stores as `writer8`, and the script dumps `content.xml`. Each scenario below is a
decision gate; the recorded shape is what LibreOffice itself authors and is therefore the
emitter's target markup. (Basic gotcha for future runs: `BASE` is a reserved word in StarBasic
— a `Const BASE` silently kills module compilation and soffice hangs without running the macro.)

- **O1 — delete one word mid-paragraph.** Kept paragraph keeps the surrounding text with a
  single point marker at the deletion offset: `Alpha <text:change/>charlie delta.`. The
  `text:deletion` region stores ONE `text:p` (host paragraph's `text:style-name`) containing
  exactly the deleted content (`bravo `). **No empty merge-artifact paragraph** — that artifact
  belongs only to whole-paragraph deletion (a deleted paragraph break).
- **O2 — insert one word mid-paragraph.** Inserted content stays inline, bracketed:
  `Alpha bravo <text:change-start/>inserted <text:change-end/>charlie delta.`; the
  `text:insertion` region holds only `office:change-info`.
- **O3 — replace a word.** ORDER CORRECTION vs the original plan: LibreOffice emits the
  insertion bracket FIRST and the deletion point marker AFTER it:
  `charlie <text:change-start/>echo<text:change-end/><text:change/>.` — i.e. the replace's
  deletion anchor sits after the replacement's `text:change-end`, not before its
  `text:change-start`. (Slice 1's whole-paragraph OCMP-10 deletion-first rule does NOT carry
  over to inline replaces.) Emitter rule: a delete span anchors at its revised offset, bumped
  past a co-located insertion's bracket; at one offset the document order is `text:change-end`,
  then `text:change`, then `text:change-start`.
- **O4 — edits at paragraph start/end.** Point markers sit as the first / last inline child of
  the paragraph: `<text:p><text:change/>bravo …` and `…paragraph <text:change/></text:p>`.
- **O5 — delete crossing a bold `text:span` boundary.** One point marker at the span's start
  offset, at the depth where the deletion begins (block level here): `Lea<text:change/>
  <text:span>word</text:span> tail.`. The stored deletion preserves the inline structure of the
  covered fragments: `<text:p>d <text:span T1>bold</text:span></text:p>`. No
  `change-start`/`change-end` depth-mismatch question arises for deletions — they are point
  markers; brackets only wrap insertions, whose content we control.
- **O6 — partial delete of `text:s text:c="5"` (2 of 5).** Kept paragraph rebalances the run
  (LO chose plain-space + `text:s text:c="2"`; count arithmetic is what matters). Stored
  content is `<text:p><text:s text:c="2"/></text:p>` — the deleted spaces as a `text:s`.
- **O7 — delete across `text:tab` / `text:line-break`.** Virtual elements are copied whole
  into the stored content (`t<text:tab/>R`, `p<text:line-break/>D`); the kept paragraph joins
  the remainders around a single point marker.
- **O8 — whole-paragraph delete + inline delete at the next paragraph's start.** LibreOffice
  COALESCES both into one `text:deletion` region: stored = full deleted paragraph + a second
  `text:p` holding the inline-deleted prefix (`Second `), one marker at the kept paragraph's
  start. (Slice 1's empty merge artifact is the special case of this where the deleted prefix
  is empty.) Our emitter keeps them as SEPARATE regions (whole-paragraph run + inline modify) —
  the composed two-marker shape is not LO-authorable, so it is verified by the accept/reject
  round-trip oracle instead (accept-all → revised text, reject-all → original text).
- **O9 — whole bold word deleted.** Stored content is the full `text:span`. The kept paragraph
  shows LO's ODF whitespace normalization (second adjacent space became `<text:s/>`). Our
  emitter does not edit kept text (the revised paragraph's encoding is kept verbatim; deleted
  text was never in it), so this normalization concern applies only to LO-authored docs, not to
  our output.
- **O10 — inline delete inside a heading.** Fully supported by LO: the kept `text:h` carries
  the point marker, and the deletion region stores a **`text:h`** mirroring the source block
  (`text:style-name`, `text:outline-level`). PLAN CORRECTION: heading modify pairs do NOT
  degrade; the stored block mirrors the host block's element name and attributes.

## Emitter structure (three lanes)

`emitTrackedChanges` plans purely, then mutates:
1. **Whole-paragraph runs** (`insert`/`delete` ops) — unchanged Slice-1 shapes. A `modify`
   paragraph is a survivor for anchoring: it advances the revised cursor like `equal` and
   terminates any open run.
2. **Inline modify plans** — per pair: `diffInline` over the two visible texts → marker
   placements (descending revised offset; each offset group resolved once via `resolveOffset`,
   markers inserted at that point in the O3 document order) + one changed-region per span.
   Deleted-span content comes from `extractVisibleRange(originalBlock, …)` imported into the
   revised doc, wrapped in a block mirroring the host (O10).
3. **Degrade valve** — a pair whose planning throws (`OdfMapError` or any span anomaly)
   re-routes to lane 1 as a whole-paragraph delete+insert at the same slot, decided before any
   markup is written; counted in `EmitResult.degradedModifications`.

Stats count changed-regions (one per inline span, one per whole-paragraph op, `modifications`
per surviving pair) so reported stats always match emitted markup.

## Round-trip oracle findings (gated `runLibreOfficeOracle`, `.odt` jobs)

Accept-all/reject-all through real LibreOffice round-trips the inline shapes exactly: a redline
mixing a modify pair, a mid-document dissimilar replacement, and an end-of-document insertion
accepts to the revised texts and rejects to the originals (`lo_inline_roundtrip.test.ts`,
[OCMPI-13]). One PRE-EXISTING Slice-1 defect surfaced: reject-all of a dissimilar
whole-paragraph replacement of the LAST paragraph merges the preceding paragraph with the
restored deletion and leaves a trailing empty paragraph (the deletion marker anchors inside the
inserted replacement paragraph while the end-of-document insertion bracket starts in the
preceding one). Filed as issue #367 and pinned as a gated characterization test; not fixed here
(one fix per PR), and #356 narrows its exposure since similar replacements now become inline
modify pairs.

## Similarity pairing

Order-constrained DP per gap (deletes-then-inserts, a shape verified exhaustively over 14,641
LCS cases): maximize pair count, then total Jaccard word-overlap (lowercase, punctuation
stripped); admissible at `similarityThreshold` (default 0.25 — docx-core's reference point).
Ties: pairing > skip-delete > skip-insert. TF-IDF (docx-core's main path) is a future upgrade —
it needs corpus-wide IDF and exists to handle boilerplate-heavy corpora.
