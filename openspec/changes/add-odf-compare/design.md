# Design notes — ODF `compare_documents` (Slice 1: paragraph granularity, two-file mode)

## Markup shapes (oracle-confirmed)
The exact tracked-changes markup below was obtained by driving LibreOffice to AUTHOR the
changes (a Basic macro: create doc, `RecordChanges = True`, mutate, store `writer8`) and
inspecting the resulting `content.xml`. It is what LibreOffice writes AND accepts, so the
emitter reproduces it verbatim. (Recipe + findings: user memory
`project_odf_tracked_deletion_shape`.)

The `text:tracked-changes` container is the **first child of `office:text`** and holds the
change definitions; the body carries lightweight markers referencing them by id.

### Insertion of a whole paragraph
`text:change-start` is inline at the **start of the inserted `text:p`**; `text:change-end` is
inline at the **start of the following kept paragraph** (the change spans the inserted content
+ its paragraph break). The `text:insertion` region carries ONLY `office:change-info` —
inserted content stays inline in the body.
```xml
<text:tracked-changes>
  <text:changed-region xml:id="ct1" text:id="ct1">
    <text:insertion><office:change-info><dc:creator>SafeDocX</dc:creator><dc:date>…</dc:date></office:change-info></text:insertion>
  </text:changed-region>
</text:tracked-changes>
…
<text:p>Alpha</text:p>
<text:p><text:change-start text:change-id="ct1"/>Beta</text:p>
<text:p><text:change-end text:change-id="ct1"/>Gamma</text:p>
```

### Insertion of a paragraph at END of document (oracle-confirmed)
There is no following kept paragraph, so LibreOffice brackets backward: `text:change-start` at
the **end of the preceding kept paragraph**, `text:change-end` at the **end of the inserted
paragraph**.
```xml
<text:p>Alpha</text:p>
<text:p>Beta<text:change-start text:change-id="ct1"/></text:p>
<text:p>Gamma<text:change-end text:change-id="ct1"/></text:p>
```

### Deletion of a whole paragraph (paragraph-break MERGE)
`text:change` is an **inline** element — schema-PROHIBITED as a direct child of `office:text`
(peer-review BLOCKER, agy). It is placed inline inside an **adjacent kept paragraph**, and the
deleted content lives out-of-line in `text:deletion`:
- **Forward merge** (first/middle paragraph deleted): marker at the **start of the following
  kept paragraph**; `text:deletion` holds `[<text:p>deletedContent</text:p>, <text:p/>]`.
- **Backward merge** (last paragraph deleted): marker at the **end of the preceding kept
  paragraph**; `text:deletion` holds `[<text:p/>, <text:p>deletedContent</text:p>]`.

The empty `<text:p/>` is the merge artifact (the surviving paragraph's mark).
```xml
<text:changed-region xml:id="ct2" text:id="ct2">
  <text:deletion>
    <office:change-info>…</office:change-info>
    <text:p>Beta</text:p><text:p/>
  </text:deletion>
</text:changed-region>
…
<text:p>Alpha</text:p>
<text:p><text:change text:change-id="ct2"/>Gamma</text:p>
```

### Consecutive deletions COALESCE into one region (oracle-confirmed)
Deleting two adjacent paragraphs (Beta + Gamma, with Alpha/Delta kept) — even as two separate
tracked operations — yields a **single** `text:changed-region` whose `text:deletion` holds
`[<text:p>Beta</text:p>, <text:p>Gamma</text:p>, <text:p/>]` and a **single** inline
`text:change` marker at the start of Delta (the next *surviving* paragraph). So the emitter
MUST:
- group **runs of consecutive deleted paragraphs** into one `text:deletion` region (all deleted
  `text:p`s in document order, then one empty merge artifact for forward merge / the empty
  artifact first for a run that reaches end-of-doc), with ONE marker; and
- anchor the marker to the next *surviving* (kept) paragraph for a forward run (or the previous
  surviving paragraph for a run that reaches end-of-doc), **skipping over the other deleted
  paragraphs** — never anchor to a paragraph that is itself deleted.
```xml
<text:changed-region xml:id="ct3" text:id="ct3">
  <text:deletion><office:change-info>…</office:change-info>
    <text:p>Beta</text:p><text:p>Gamma</text:p><text:p/>
  </text:deletion>
</text:changed-region>
…
<text:p>Alpha</text:p>
<text:p><text:change text:change-id="ct3"/>Delta</text:p>
```
A backward consecutive run (delete the last two paragraphs Gamma+Delta) yields the empty
artifact **first**, then the deleted paras, with the marker at the **end of the preceding
surviving paragraph**:
```xml
<text:deletion>…<text:p/><text:p>Gamma</text:p><text:p>Delta</text:p></text:deletion>
…
<text:p>Beta<text:change text:change-id="ct3"/></text:p>
```

### Modified paragraph = delete + insert at the same slot (oracle-confirmed; markers CO-EXIST)
A paragraph "modified" Beta → Beta' is diffed as `delete Beta` + `insert Beta'`. The deletion's
inline `text:change` marker and the insertion's `text:change-start` BOTH land at the start of
the inserted replacement paragraph, and LibreOffice accepts them — ordered **deletion
`text:change` FIRST, then insertion `text:change-start`** (so the emitter must emit the deletion
anchor before the insertion start when both target the same position). This means modified
paragraphs do NOT need to fail closed in Slice 1.
```xml
<text:p><text:change text:change-id="DEL"/><text:change-start text:change-id="INS"/>Beta2</text:p>
<text:p><text:change-end text:change-id="INS"/>Gamma</text:p>
```
(The deletion region for Beta holds `[<text:p>Beta</text:p>, <text:p/>]` as a normal forward
merge; the insertion region holds only change-info.) A modified LAST paragraph composes the
backward-delete anchor with the EOF-insert bracket by the same first-deletion-then-insertion
ordering rule.

## Existing `text:tracked-changes` in the revised doc (Codex MAJOR)
The emitter writes into the revised content.xml. If `office:text` already has a
`text:tracked-changes` first child, the emitter SHALL **reuse/append** new `text:changed-region`s
to that existing container (never create a second container) and allocate `ctN` ids past the
existing ones. (For Slice 1's two-file inputs this is rare, but the emitter must not assume the
container is absent.)
`OdfDocument.doc`/`blocks` are `private` and there is no public DOM accessor. So
`compareOdf(originalContentXml, revisedContentXml, opts)` takes content.xml **strings** and
parses each exactly once internally (via the `parseXml` odf-core already depends on from
docx-core); `diff.ts` and `emit.ts` operate on those local `Document`s. No Element crosses the
package boundary and NO public DOM getter is added (keeps the surface minimal; avoids the
"redundant parse" concern by parsing once in `compareOdf`, not once per `OdfDocument`). To
avoid duplicating the walk, `collectBlocks` + the skip predicates move into `shared/odf/`
(the same extraction pattern 2b-1 used for `text_segments.ts`), reused by `OdfDocument` and
`compare/index.ts` without a cycle.

## Dispatch (peer-review BLOCKER — Codex)
Two-file compare CANNOT route through the generic `dispatchOdf()`: it always calls
`resolveOdfSessionForTool()`, which requires `file_path` and returns `MISSING_FILE_PATH` for
two-file input (`original_file_path`/`revised_file_path`) before any handler runs. So
`odfCompareDocuments` is **stateless** — signature `(manager, args, metadata)`, mirroring the
DOCX `compareDocuments_tool(sessions, args)` — and `server.ts` dispatches to it directly for
`.odt` two-file input. A `.odt` session `file_path` returns `UNSUPPORTED_FOR_ODF` in Slice 1
(session mode is a follow-up change); it does NOT silently degrade.

The handler MUST match the DOCX compare's write-path safety (Codex MAJOR): reject when
`save_to_local_path` resolves to either source file (`resolvesToSamePath`) and run
`enforceWritePathPolicy(savePath)` before writing. The output path should be `.odt`.

## Diff (paragraph LCS)
`compare/diff.ts` runs a generic O(N·M) LCS over the two `getParagraphs()` text arrays
(conceptually mirroring docx-core `atomLcs.ts::computeAtomLcs`) and returns a structured edit
script `{kind:'equal'|'insert'|'delete', originalIndex?, revisedIndex?}[]`. No DOM, unit-tested
in isolation.

## Stats semantics (both reviewers)
At paragraph granularity a "modified" paragraph is represented as a **delete of the old +
insert of the new** (no run-level merge yet), so `modifications` is always `0` in Slice 1 and
those edits land in `insertions`/`deletions`. A single changed word therefore reads as 1
deletion + 1 insertion. The handler `message` states that changes are tracked at the
whole-paragraph level so the counts are expected to run higher than the DOCX (atom-level) path.

## `ctN` id allocation
`xml:id` + `text:id` per `text:changed-region` are allocated `ct1, ct2, …` by scanning all
existing ids in both docs, mirroring the `office:name` allocator in `comments.ts`. The reader
and the writer reserve the same id space (reviewer bug class from 2b-1).

## Degenerate cases (fail closed, never emit invalid markup)
A deleted paragraph with no adjacent kept paragraph (all paragraphs deleted; single-paragraph
doc) has no inline anchor available. The emitter MUST fail closed / log rather than place a
`text:change` as an invalid block child of `office:text`. Covered by an explicit test.

## No-leak invariant (peer-review scrutiny carried from 2b-1)
`collectBlocks` and `buildSegments` recurse into every child; the deleted `text:p`s inside
`text:tracked-changes` would otherwise inflate `getParagraphs()` and register phantom blocks.
Both traversals skip the `text:tracked-changes` subtree via `isTrackedChangesSubtree`, with an
explicit no-leak regression test (mirrors OANN-05).

## LibreOffice is the authoritative compatibility check
The produced redline `.odt` must open in LibreOffice with the changes visible/acceptable
(Edit ▸ Track Changes ▸ Manage). Local checks are semantic/structural (tracked-changes regions
+ in-body markers present, untouched paragraphs' visible text preserved, mimetype-first
STORED); the document-shaped smoke reopens the redline in LibreOffice.
