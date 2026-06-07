# Design notes — ODF `add_comment` + `get_comments`

## Markup: `office:annotation` (inline in `content.xml`)
ODF comments are inline annotations, not a separate part. A whole-paragraph comment brackets the
paragraph's inline content; a ranged comment brackets a substring:
```xml
<text:p>
  <office:annotation office:name="__Annot__1">
    <dc:creator>Jane Doe</dc:creator>
    <dc:date>2026-06-06T00:00:00</dc:date>
    <text:p>The comment body.</text:p>
  </office:annotation>Hello world<office:annotation-end office:name="__Annot__1"/>
</text:p>
```
The basic markup (annotation parent + `dc:creator`/`dc:date`/`text:p` body, paired
`office:annotation-end` by `office:name`) is conformant under the ODF 1.2/1.3 reference and is what
LibreOffice writes/reads.

## B1 — annotation body must not leak into the paragraph stream (peer-review BLOCKER)
`OdfDocument.collectBlocks` and `buildSegments` recurse into every child. An `office:annotation`
contains a `<text:p>` body, so without a guard that body both (a) inflates the anchor paragraph's
visible text and (b) registers as a phantom `pN` block. Reproduced on built `dist`:
`Hello <annotation>…<text:p>Comment body</text:p></annotation>world` →
`[{p0,"Hello A…Comment bodyworld"},{p1,"Comment body"}]`. Fix: both traversals skip
`office:annotation` / `office:annotation-end` subtrees via a shared `isAnnotationSubtree` guard.
This is covered by an explicit no-leak regression test.

## B2 — two insertion paths, not one (peer-review BLOCKER)
The Phase-1 `replaceTextById` single-`#text`-node contract is right for `anchor_text` but wrong for
whole-paragraph anchoring (it would fail on paragraphs with `text:span`/`text:s`/`text:tab`/multiple
text nodes). So:
- **Whole-paragraph** (`addWholeBlockAnnotation`): purely structural — annotation as the block's
  first inline child, `office:annotation-end` after its last inline child. Independent of text
  segmentation. Empty paragraph → a single point annotation (no end).
- **Ranged** (`addRangedAnnotation`): resolve the host `#text` node via `buildSegments`; cross-node
  match → `MATCH_SPANS_MULTIPLE_NODES`. Split the host at `end` then at `start`; insert the
  annotation before the middle text node and `office:annotation-end` after it.

## `office:name` / comment ids
Generated names are allocated by scanning ALL existing `office:name` values: pick the smallest `N`
where `__Annot__N` collides with none and `N` exceeds every numeric suffix present. `commentId = N`.
`get_comments` parses `__Annot__<n>` for the numeric id; annotations whose names don't match are
assigned ids sequentially after the max parsed value, deterministically by document order (a
documented limitation — real `.odt`s from LibreOffice use the `__Annot__N` convention).

## Replies deferred
ODF has no first-class reply graph (DOCX links replies via `commentsExtended.xml`). Inventing a
thread convention now would be fragile, so `parent_comment_id` on a `.odt` returns
`UNSUPPORTED_FOR_ODF`; `get_comments` returns `replies: []` for every ODF comment. Threading is a
later phase.

## Parity & dispatch
Handlers mirror the DOCX `add_comment`/`get_comments` param + response shapes (`author` stays
required; comment body param is `text`; `get_comments` returns the `McpComment` shape). Inserting an
annotation does NOT shift positional paragraph IDs (annotations are inline children and are skipped
by `collectBlocks`), so no `invalidates_paragraph_ids_after` field is emitted. `isOdfRequest` keys on
the `.odt` extension and is checked after the gdocs branch; the `resolveSessionForTool` chokepoint
still returns `UNSUPPORTED_FOR_ODF` for any tool not in the ODF set before a DocxSession cast.
