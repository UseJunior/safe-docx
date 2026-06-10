## ADDED Requirements

### Requirement: ODF paragraph comparison + tracked-changes emission (`compareOdf`)

`@usejunior/odf-core` SHALL provide `compareOdf(originalContentXml, revisedContentXml, opts)`
returning `{ contentXml, stats: { insertions, deletions, modifications } }`, where `contentXml`
is a redline `content.xml` carrying ODF tracked-changes markup and `stats` counts the
whole-paragraph edits. `compareOdf` SHALL take `content.xml` **strings** and parse each exactly
once internally; it SHALL NOT require any DOM Element to cross the package boundary and SHALL
NOT add a public DOM accessor to `OdfDocument`.

The diff SHALL be a pure paragraph-level LCS over the two documents' block text (the same block
set `getParagraphs()` enumerates), kept in a separate module from emission and unit-tested in
isolation. A modified paragraph SHALL be emitted as a deletion plus an insertion, so
`modifications` SHALL be `0` at this granularity.

The emitter SHALL write a `text:tracked-changes` container as the first child of `office:text`,
with one `text:changed-region` per change (unique `xml:id` + `text:id` allocated `ctN` by
scanning existing ids; `office:change-info` carrying `dc:creator` from `opts.author` and a
`dc:date`):
- An **inserted** paragraph with a following kept paragraph SHALL be bracketed by
  `text:change-start` (inline at the start of the inserted `text:p`) and `text:change-end`
  (inline at the start of the following kept paragraph), referencing a `text:insertion` region;
  the inserted content SHALL remain inline. An inserted paragraph at **end of document** (no
  following kept paragraph) SHALL instead place `text:change-start` at the **end of the
  preceding kept paragraph** and `text:change-end` at the **end of the inserted paragraph**.
- A **run of one or more consecutive deleted** paragraphs SHALL be stored as a single
  `text:deletion` region (the deleted `text:p`s in document order plus one empty merge-artifact
  `text:p`) with a single inline `text:change` marker. The marker SHALL be placed in the nearest
  *surviving* (kept) paragraph — at the start of the following surviving paragraph (forward
  merge) or the end of the preceding surviving paragraph (backward merge for a run reaching
  end-of-document) — **skipping over other deleted paragraphs**; it SHALL NEVER anchor to a
  paragraph that is itself deleted. `text:change` SHALL NOT be emitted as a direct block child
  of `office:text` (it is an inline element). When a deletion run has no surviving paragraph to
  anchor to (every paragraph deleted), the emitter SHALL fail closed rather than emit
  schema-invalid markup.
- A **modified** paragraph (matched position, changed text) SHALL be emitted as a deletion of
  the old paragraph plus an insertion of the new one. When the deletion's inline `text:change`
  marker and the insertion's `text:change-start` target the same position (the start of the
  inserted replacement paragraph), the `text:change` (deletion) marker SHALL be emitted BEFORE
  the `text:change-start` (insertion) marker.
- A deletion run whose following paragraph belongs to an inserted run that itself reaches
  **end of document** (a whole-paragraph replacement of the LAST paragraph) SHALL anchor
  **backward** — empty merge artifact first, inline `text:change` marker at the end of the
  preceding surviving paragraph, BEFORE the insertion's end-anchored `text:change-start` — so
  the marker stays outside the insertion span and rejecting the insertion cannot remove the
  deletion's restore point. (A forward marker would sit inside the inserted paragraph, and
  reject-all would merge the preceding paragraph with the restored one and leave a trailing
  empty paragraph.) When no preceding paragraph exists (`revisedCursor` 0), the forward
  placement stands.

`compareOdf` SHALL preserve the unchanged paragraphs' visible text and the rest of the revised
document (styles, manifest, untouched parts) so the redline round-trips.

An emitted redline's deleted content SHALL NOT appear in `getParagraphs()`: both `collectBlocks`
and the visible-text walk SHALL skip the `text:tracked-changes` subtree.

#### Scenario: [OCMP-01] Paragraph LCS yields an insert/delete/equal edit script
- **WHEN** the diff runs over an original and a revised paragraph-text array that differ by one added and one removed paragraph
- **THEN** the edit script marks the added paragraph `insert`, the removed paragraph `delete`, and the common paragraphs `equal`

#### Scenario: [OCMP-02] Inserted paragraph is bracketed by change-start/-end
- **WHEN** `compareOdf` emits an inserted paragraph
- **THEN** a `text:change-start` sits at the start of the inserted `text:p`, a `text:change-end` with the same `text:change-id` sits at the start of the following kept paragraph, and a matching `text:changed-region`/`text:insertion` exists

#### Scenario: [OCMP-03] Deleted middle paragraph uses a forward-merge anchor
- **WHEN** `compareOdf` deletes a paragraph that has a following kept paragraph
- **THEN** an inline `text:change` marker sits at the start of the following kept paragraph and the deleted content is stored in a `text:deletion` region (no `text:change` is a block child of `office:text`)

#### Scenario: [OCMP-04] Deleted last paragraph uses a backward-merge anchor
- **WHEN** `compareOdf` deletes the last paragraph (no following kept paragraph)
- **THEN** an inline `text:change` marker sits at the end of the preceding kept paragraph and the deleted content is stored in a `text:deletion` region

#### Scenario: [OCMP-05] Change ids are unique and reserve the reader's id space
- **WHEN** `compareOdf` emits multiple changes
- **THEN** each `text:changed-region` carries a unique `xml:id`/`text:id` allocated by scanning existing ids, with no collisions

#### Scenario: [OCMP-06] Deleted content does not leak into the paragraph stream
- **WHEN** `getParagraphs()` is called on a redline document containing a `text:tracked-changes` container
- **THEN** it returns only the body paragraphs (with their visible text) and creates no phantom block for the deleted `text:p`s stored in `text:deletion`

#### Scenario: [OCMP-07] Consecutive deletions coalesce into one region
- **WHEN** `compareOdf` deletes two or more consecutive paragraphs that have a following surviving paragraph
- **THEN** a single `text:changed-region`/`text:deletion` stores all the deleted `text:p`s in order with one empty merge artifact, and a single inline `text:change` marker sits in the following surviving paragraph (none of the deleted paragraphs is used as an anchor)

#### Scenario: [OCMP-08] Consecutive deletion run at end of document
- **WHEN** `compareOdf` deletes the final two or more paragraphs (no following surviving paragraph)
- **THEN** a single `text:deletion` region stores the empty merge artifact first then the deleted `text:p`s, and a single inline `text:change` marker sits at the end of the preceding surviving paragraph

#### Scenario: [OCMP-09] Insertion at end of document brackets backward
- **WHEN** `compareOdf` inserts a paragraph after the last paragraph of the document
- **THEN** `text:change-start` sits at the end of the preceding kept paragraph and `text:change-end` sits at the end of the inserted paragraph

#### Scenario: [OCMP-10] Modified paragraph orders deletion before insertion markers
- **WHEN** `compareOdf` emits a modified paragraph whose deletion `text:change` and insertion `text:change-start` target the start of the same replacement paragraph
- **THEN** the `text:change` (deletion) marker precedes the `text:change-start` (insertion) marker in that paragraph

#### Scenario: [OCMP-11] Replaced last paragraph anchors the deletion backward, outside the insertion bracket
- **WHEN** `compareOdf` emits a whole-paragraph replacement of the LAST paragraph (a deletion run immediately followed by an inserted run reaching end-of-document)
- **THEN** the deletion stores the empty merge artifact first and its inline `text:change` marker sits at the end of the preceding surviving paragraph, BEFORE the insertion's end-anchored `text:change-start` (never inside the inserted replacement paragraph), so LibreOffice's reject-all restores the original paragraphs without merging or leaving a trailing empty paragraph
