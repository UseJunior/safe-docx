## ADDED Requirements

### Requirement: ODF Paragraph Insertion

`OdfDocument` SHALL provide `insertParagraph(id, text, position)` that inserts one or more
block-level paragraphs (`text:p`) before or after the paragraph identified by `id`. The
method SHALL split `text` on blank lines (`\n{2,}`) into separate paragraphs and map a single
newline within a block to a `text:line-break`. It SHALL inherit the anchor paragraph's
`text:style-name` only when the anchor is itself a `text:p`; when the anchor is a heading
(`text:h`), the inserted blocks SHALL be default body paragraphs without the heading style.

Because paragraph IDs are positional ordinals, insertion SHALL rebuild the structural block
index and SHALL return the inserted blocks' freshly recomputed IDs in document order. A
non-resolving anchor `id` SHALL return an `ANCHOR_NOT_FOUND` result rather than throwing.

#### Scenario: [OINS-01] Insert after a body paragraph
- **WHEN** `insertParagraph(id, "New text", "AFTER")` is called for a `text:p` anchor
- **THEN** a new `text:p` carrying the anchor's style is inserted immediately after it, and its new positional ID is returned

#### Scenario: [OINS-02] Insert before, heading anchor does not propagate heading style
- **WHEN** `insertParagraph(id, "Body", "BEFORE")` is called for a `text:h` anchor
- **THEN** a default body `text:p` (no heading style) is inserted immediately before it

#### Scenario: [OINS-03] Blank lines split into multiple paragraphs
- **WHEN** `text` contains a blank line (`\n\n`)
- **THEN** multiple `text:p` blocks are created and all of their new IDs are returned

#### Scenario: [OINS-04] Unknown anchor returns ANCHOR_NOT_FOUND
- **WHEN** `insertParagraph` is called with an id that does not resolve to a block
- **THEN** an `{ ok: false, code: 'ANCHOR_NOT_FOUND' }` result is returned (no throw)
