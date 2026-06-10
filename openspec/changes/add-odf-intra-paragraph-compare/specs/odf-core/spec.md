## ADDED Requirements

### Requirement: ODF intra-paragraph comparison (modify pairs + inline tracked changes)

`compareOdf` SHALL detect **modify pairs**: an aligned-but-differing original/revised paragraph
pair whose Jaccard word-overlap (lowercased, punctuation-stripped word sets) is at least
`opts.similarityThreshold` (default `0.25`). Pairing SHALL run as a post-pass over the
paragraph-level LCS, inside each gap (a run of deletes followed by a run of inserts between two
anchors), using an order-constrained, deterministic DP that maximizes the pair count and then
the total similarity; at ties, pairing beats skipping and skipping a delete beats skipping an
insert. Empty paragraphs SHALL never pair. Below-threshold pairs SHALL keep the Slice-1
whole-paragraph delete+insert representation.

For a modify pair, the engine SHALL diff **within** the paragraph using a pure token-level LCS
over the two visible-text strings (tokens are maximal whitespace or non-whitespace runs — a
partition, so spans land on word boundaries and map losslessly to char offsets), with the
common token prefix/suffix trimmed before the DP. A replaced word SHALL surface as a `delete`
span immediately followed by an `insert` span sharing the same revised offset.

The emitter SHALL keep the modify pair's revised paragraph in place and emit inline markup:
- An **inserted span** SHALL remain inline, bracketed by `text:change-start` and
  `text:change-end` markers referencing a `text:insertion` changed-region.
- A **deleted span** SHALL leave a single inline `text:change` point marker at the deletion
  offset; its content SHALL move out-of-line into a `text:deletion` changed-region holding one
  block element **mirroring the host block** (`text:p` or `text:h`, carrying its
  `text:style-name` and, for headings, `text:outline-level`) with the deleted inline content —
  and NO empty merge-artifact paragraph, since no paragraph break was deleted. Inline
  formatting (`text:span`, hyperlinks) of the deleted content SHALL be preserved in the stored
  copy.
- Span boundaries SHALL be mapped onto the revised paragraph's DOM by splitting `#text` nodes
  and `text:s` runs (rebalancing `text:c`) at the visible offsets; `text:tab` and
  `text:line-break` are length-1 and SHALL only ever be covered whole. Markers SHALL sit at the
  split point's natural nesting depth.
- When a deleted span and an inserted span share an offset (a replacement), the insertion
  bracket SHALL come first and the `text:change` point marker SHALL follow the
  `text:change-end` — the LibreOffice-authored order. At a single offset the document order
  SHALL be `text:change-end`, then `text:change`, then `text:change-start`. When
  intra-paragraph markers and a whole-paragraph deletion marker share a paragraph start, the
  whole-paragraph `text:change` SHALL precede the intra-paragraph markers.

A modify pair whose spans cannot be mapped cleanly onto the DOM SHALL **degrade** to the
Slice-1 whole-paragraph delete+insert for that pair, decided before any of its markup is
written.

Stats SHALL count changed-regions: each successful modify pair adds 1 to `modifications`, each
of its inserted spans adds 1 to `insertions`, and each of its deleted spans adds 1 to
`deletions`; whole-paragraph ops keep their Slice-1 counting (1 per paragraph); a degraded pair
counts 1 insertion + 1 deletion and no modification.

The Slice-1 no-leak invariant SHALL hold unchanged: content stored in `text:tracked-changes`
SHALL NOT appear in `getParagraphs()` or any visible-text walk.

#### Scenario: [OCMPI-01] Inner token diff yields word-boundary spans that reconstruct both strings
- **WHEN** the intra-paragraph diff runs over two visible-text strings differing by one word
- **THEN** it returns equal/delete/insert spans on word boundaries whose equal+delete spans concatenate to the original and equal+insert spans to the revised, with the delete ordered before the insert at the shared offset

#### Scenario: [OCMPI-02] Similar aligned paragraphs pair as modify; dissimilar fall back
- **WHEN** the post-pass examines a gap whose delete/insert pair shares at least the similarity threshold of words (and another whose pair shares almost none)
- **THEN** the similar pair becomes a single `modify` op and the dissimilar pair stays a whole-paragraph delete plus insert

#### Scenario: [OCMPI-03] Inline insertion is bracketed in the kept paragraph
- **WHEN** `compareOdf` processes a modify pair whose revised text adds a word mid-paragraph
- **THEN** the kept paragraph contains `text:change-start` and `text:change-end` around exactly the inserted word, referencing a `text:insertion` region, and the rest of the paragraph is untouched

#### Scenario: [OCMPI-04] Inline deletion leaves a point marker and stores content without a merge artifact
- **WHEN** `compareOdf` processes a modify pair whose revised text removes a word
- **THEN** the kept paragraph contains a single `text:change` point marker at the deletion offset, the `text:deletion` region stores one `text:p` containing exactly the deleted content, and no empty merge-artifact paragraph is added

#### Scenario: [OCMPI-05] A replaced word orders the insertion bracket before the deletion marker
- **WHEN** a modify pair replaces one word (delete span and insert span share an offset)
- **THEN** the `text:change` point marker appears immediately after the insertion's `text:change-end`, matching the LibreOffice-authored replace shape

#### Scenario: [OCMPI-06] Stored inline deletion content does not leak into the paragraph stream
- **WHEN** `getParagraphs()` runs over a redline containing inline modify markup
- **THEN** each modified paragraph's visible text is exactly the revised text and the deleted spans appear nowhere in the paragraph stream

#### Scenario: [OCMPI-07] Intra-paragraph markers compose with whole-paragraph changes at a shared anchor
- **WHEN** a document deletes paragraph N−1 entirely and also has a modify pair at paragraph N with an edit at offset 0
- **THEN** the whole-paragraph deletion's `text:change` marker precedes the intra-paragraph markers at the start of paragraph N and both changes accept/reject independently

#### Scenario: [OCMPI-08] Unmappable modify pairs degrade to whole-paragraph delete+insert
- **WHEN** a modify pair's span mapping fails
- **THEN** that pair is emitted as a Slice-1 whole-paragraph deletion plus insertion with no partial inline markup, and stats count it as one insertion plus one deletion

#### Scenario: [OCMPI-09] Stats count changed-regions
- **WHEN** a compare produces one modify pair containing two deleted spans and one inserted span plus one whole-paragraph insertion
- **THEN** stats report `modifications: 1`, `deletions: 2`, `insertions: 2`

#### Scenario: [OCMPI-10] Edits touching virtual segments map onto the DOM correctly
- **WHEN** a deleted span covers part of a `text:s` run (or a whole `text:tab`/`text:line-break`)
- **THEN** the `text:s` count is rebalanced at the boundary (tab/line-break copied whole into the stored content) and the redline's visible text equals the revised text

#### Scenario: [OCMPI-11] Formatting spans are preserved in stored deletion content
- **WHEN** a deleted span covers text inside a `text:span` (or crosses its boundary)
- **THEN** the stored deletion content keeps the `text:span` structure for the covered portion and the kept paragraph's remaining formatting is unchanged

#### Scenario: [OCMPI-12] Heading modify pairs store a mirrored `text:h`
- **WHEN** a modify pair's host block is a `text:h` with a deleted span
- **THEN** the `text:deletion` region stores a `text:h` carrying the host's `text:style-name` and `text:outline-level`, and the kept heading carries the point marker inline

#### Scenario: [OCMPI-13] LibreOffice accept/reject round-trips the inline redline
- **WHEN** LibreOffice (when available) runs accept-all and reject-all over a generated redline containing a modify pair plus whole-paragraph changes
- **THEN** accept-all reproduces the revised document's visible paragraph texts and reject-all reproduces the original's

#### Scenario: [OCMPI-14] Adjacent word replacements group into one deletion and one insertion
- **WHEN** the intra-paragraph diff processes adjacent replaced words separated only by whitespace that the token LCS matches as equal (e.g. "Zephyr BioSystems" → "Acme Manufacturing")
- **THEN** the span script contains a single delete+insert pair covering the whole replacement (bridge whitespace absorbed into both sides) rather than interleaved per-word pairs, while delete-only and insert-only runs keep their bridging whitespace as equal
