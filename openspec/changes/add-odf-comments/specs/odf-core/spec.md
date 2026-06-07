## ADDED Requirements

### Requirement: ODF Annotations (read/write)

`OdfDocument` SHALL provide `addComment(params)` and `getComments()` backed by ODF
`office:annotation` markup inline in `content.xml`.

`addComment` SHALL insert an `office:annotation` carrying `dc:creator`, `dc:date`, and a `text:p`
body, with an `office:name` allocated so it collides with no existing annotation name. When a
visible `start`/`end` range is omitted, the annotation SHALL bracket the whole anchor paragraph by
structural insertion (annotation as the first inline child, `office:annotation-end` after the last
inline child) independent of text segmentation; an empty paragraph SHALL receive a single point
annotation. When a range is given, the annotation SHALL bracket exactly that range by splitting the
host `#text` node, and a range that crosses inline node boundaries SHALL return a
`MATCH_SPANS_MULTIPLE_NODES` result rather than throwing.

`getComments` SHALL return every annotation in document order with its id (parsed from
`office:name`), author (`dc:creator`), date (`dc:date` or null), body text, and the positional id of
the anchor paragraph.

An annotation's body SHALL NOT appear in `getParagraphs()` visible text and SHALL NOT register as a
paragraph block: both `collectBlocks` and the visible-text walk SHALL skip `office:annotation` /
`office:annotation-end` subtrees.

#### Scenario: [OANN-01] addComment brackets a range
- **WHEN** `addComment` is called with a visible `start`/`end` range inside a single text node
- **THEN** an `office:annotation` is inserted at `start` and an `office:annotation-end` with the same `office:name` at `end`

#### Scenario: [OANN-02] getComments reads annotation metadata
- **WHEN** `getComments` is called on a document containing an annotation
- **THEN** the returned record carries the `dc:creator` author, the `dc:date` date, the body text, and the anchor paragraph's positional id

#### Scenario: [OANN-03] Whole-paragraph anchoring survives spans and spaces
- **WHEN** `addComment` is called with no range on a paragraph containing `text:span` / `text:s` content
- **THEN** the annotation brackets the entire paragraph via structural insertion without a `MATCH_SPANS_MULTIPLE_NODES` failure

#### Scenario: [OANN-04] Cross-node ranged match is rejected
- **WHEN** `addComment` is called with a range that crosses inline node boundaries
- **THEN** an `{ ok: false, code: 'MATCH_SPANS_MULTIPLE_NODES' }` result is returned (no throw)

#### Scenario: [OANN-05] Annotation body does not leak into the paragraph stream
- **WHEN** a paragraph carries an `office:annotation` whose body is a `text:p`
- **THEN** `getParagraphs()` returns only the host paragraph's visible text (without the comment body) and creates no phantom block for the annotation body
