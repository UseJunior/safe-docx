## ADDED Requirements

### Requirement: Cross-references in generated documents

`generateDocx` SHALL accept a `bookmark` name on a body paragraph and a
`{ kind: 'crossReference', bookmark, number?: 'fullContext' | 'paragraph' }`
inline. It SHALL emit the bookmark as `w:bookmarkStart`/`w:bookmarkEnd` around
the paragraph's content, and the reference as a REF field (`\w` or `\n`, with
`\h`) whose cached result is the number Word shows for the target after
updating fields. A spec without bookmarks or cross-references SHALL compile to
the same bytes as before.

#### Scenario: [SDX-GEN-122] bookmarked paragraphs wrap their content in a bookmark with an annotation id of its own
- **GIVEN** a bookmarked heading with a drafting note, a bookmarked paragraph in a table cell and an empty bookmarked list item
- **WHEN** the document is generated
- **THEN** each bookmark SHALL start after the paragraph properties and end after the content, enclosing the comment range
- **AND** bookmark and comment ids SHALL come from one sequence, so no annotation id repeats
- **AND** the package SHALL pass the structural check, including bookmark pairing, and regenerate byte for byte
- **AND** a spec without bookmarks SHALL keep its comment ids and write no bookmark

#### Scenario: [SDX-GEN-123] cross-references emit REF fields whose cached result is the target number
- **GIVEN** references before and after their targets, formatted, in both number forms, in a table cell and in a footnote, to legal-numbered targets
- **WHEN** the document is generated
- **THEN** each reference SHALL be a five-run complex field with the instruction ` REF <name> \w \h ` or ` REF <name> \n \h `
- **AND** each cached result SHALL be the number Word shows, such as `Section 2.02(b)`, `(b)`, `ARTICLE II` and `Section 2.02(b)(i)`
- **AND** every run of a formatted reference SHALL carry its formatting

#### Scenario: [SDX-GEN-124] cached results equal Word results for every recorded numbering shape
- **GIVEN** the spec and the Word 16.114 after-update results recorded in the #1236 oracle evidence
- **WHEN** the recorded spec is generated again
- **THEN** every field SHALL have the recorded instruction and a cached result equal to Word's
- **AND** the instructions SHALL include the ones Word itself writes for a hyperlinked full-context and no-context cross-reference
- **AND** letter numbers past `z` SHALL repeat the letter (`aa`, `bb`, `zz`, `aaa`) in both cases and both number forms, as Word shows them
- **AND** targets after skipped list levels SHALL carry the results recorded in the #1254 oracle evidence: an ancestor no paragraph has numbered shows its start value (`Section 1.01(a)` for a list that opens with a clause) and is passed over when a level above it has a paragraph (`ARTICLE II(a)`)
- **AND** a full-context number SHALL pass over a parent level whose level text names a deeper level, so the #1236 `deep2` target reads `(a)` in both number forms, as Word shows it

#### Scenario: [SDX-GEN-125] invalid bookmarks and cross-references are rejected
- **GIVEN** bookmark names that Word's Bookmark dialog refuses, names repeated without regard to case, bookmarks outside the body, references to undeclared bookmarks, references in a footer, unknown number forms, and targets that are unnumbered, whose own level text names a deeper level (Word shows no number for it), whose number uses a placeholder past `%9`, or that render as empty text
- **WHEN** each is generated
- **THEN** generation SHALL fail with a `GenerationSpecError` whose path names the bookmark or the reference
- **AND** a reference to an undeclared bookmark SHALL fail with `dangling_bookmark_reference`

#### Scenario: [SDX-GEN-126] kebab-case ids map to Word bookmark names and colliding ids fail
- **GIVEN** short and long kebab-case ids
- **WHEN** they are mapped to bookmark names
- **THEN** hyphens SHALL become underscores, and an id longer than 40 characters SHALL keep 31 characters plus `_` and 8 hex digits of its SHA-256
- **AND** an id that cannot become a visible bookmark name SHALL be refused
- **AND** ids that map to one name, regardless of case, SHALL fail with both ids named
