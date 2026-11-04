## ADDED Requirements

### Requirement: Numbered headings in created documents

With frontmatter `heading-numbers: legal`, `docx-markdoc create` SHALL
number each `##` heading `ARTICLE I`, `ARTICLE II`, … and each `###` heading
`Section <article>.<nn>`, through one abstract numbering definition whose
heading levels link to the Heading 1 and Heading 2 styles. The ordered
lists under a numbered heading SHALL be that definition's clause levels,
numbered `(a)`, `(i)`, `(A)` and restarting under each heading. An
`{% xref %}` SHALL be able to name a numbered heading or such a clause, and
its cached result SHALL be the number Word shows. The read-back, round-trip,
cross-reference and PDF checks SHALL hold the numbers to the source. A
source that Word would number differently from its markers SHALL fail
closed. Without the key, headings SHALL stay unnumbered.

#### Scenario: [SDX-MDOC-HEADNUM-01] heading-numbers legal numbers headings and the clause lists under them with one style-linked definition
- **GIVEN** a source with `heading-numbers: legal`, a list before the first heading, two `##` headings, `###` headings, nested ordered lists under them, a list continuing after a paragraph, and a bullet list
- **WHEN** the source is created
- **THEN** the certificate SHALL pass, and the read side SHALL label the headings `ARTICLE I`, `Section 1.01`, `ARTICLE II`, `Section 2.01` and the clauses `(a)`, `(b)`, `(i)`, `(A)`, `(c)`, with the earlier list numbered `1.` and the bullet kept
- **AND** the heading definition SHALL be `ARTICLE %1` upper Roman linked to Heading1, `Section %1.%2` decimal-zero with `w:isLgl` linked to Heading2, then `(%3)`, `(%4)`, `(%5)`, with no level text ending in a period
- **AND** the heading paragraphs SHALL carry no `w:numPr` of their own, and the Heading1 and Heading2 styles SHALL carry levels 0 and 1
- **AND** without the key, headings SHALL be unnumbered and a literal heading number SHALL stay text

#### Scenario: [SDX-MDOC-HEADNUM-02] cross-references to numbered headings and their clauses show the numbers Word shows and renumber with them
- **GIVEN** xrefs to Articles, Sections and clauses in both number forms
- **WHEN** the source is created
- **THEN** a heading SHALL show its label in both forms (`ARTICLE I`, `Section 1.01`), and a clause `Section 1.01(b)(i)(A)` in full and `(A)` as a paragraph number
- **AND** in Word 16.114, the after-update REF results of the recorded document SHALL equal the cached results, as recorded in `scripts/oracle/word/evidence/issue-1250-word-16.114.json`
- **AND** the read side's labels SHALL equal Word's list strings before and after a Section is inserted in Article II or Article I and after an Article is inserted, and Word's REF results after the insertion SHALL be the renumbered targets' new numbers

#### Scenario: [SDX-MDOC-HEADNUM-03] verification holds numbered headings and their references to the source
- **GIVEN** a source with numbered headings, and lowerings that number the Sections from 2 (projected consistently) or move a heading's bookmark to another heading
- **WHEN** each is verified
- **THEN** the source projection SHALL give each heading its label as generated text, each clause its `(a)`-style marker, and each heading bookmark its heading's text, with the same reference texts for LibreOffice
- **AND** the renumbered lowering SHALL pass the read-back but fail the round trip, and the moved bookmark SHALL fail the cross-reference check
- **AND** the PDF word check SHALL expect each heading label as two words and fail when a label is missing or wrong
- **AND** a real LibreOffice PDF of the source SHALL pass the PDF checks

#### Scenario: [SDX-MDOC-HEADNUM-04] heading numbering fails closed on sources Word would number differently
- **GIVEN** sources with an unknown `heading-numbers` value, a `###` before any `##`, a heading repeating its number, a list under a heading that neither starts at 1 nor continues the list before it under the same heading, a Section after clauses directly under its Article, a full-form xref to a clause directly under an Article, `format="section"` on a heading-numbered target, and an xref to the title
- **WHEN** each is created
- **THEN** creation SHALL fail with `UNSUPPORTED_CREATION_FRONTMATTER`, `HEADING_NUMBER_SKIPS_LEVEL`, `DUPLICATE_HEADING_NUMBER`, `HEADING_LIST_START`, `SECTION_AFTER_ARTICLE_CLAUSES`, `XREF_FULL_NUMBER_UNDER_ARTICLE`, `INVALID_CROSS_REFERENCE` or `XREF_TARGET_NOT_NUMBERED`, with the source line where it applies
- **AND** a paragraph-form xref to a clause directly under an Article SHALL show `(a)`, and a list continuing the previous list under the same heading SHALL be admitted
- **AND** an xref to an unnumbered heading SHALL name `heading-numbers: legal` in its message
