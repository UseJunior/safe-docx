# Change: Relative cross-references

## Why

`{% xref %}` and `CrossReferenceSpec` can show a number in full ("Section
2.06(b)(ii)", Word's `\w`) or the target's own level ("(ii)", `\n`). Legal
drafting often wants the relative form Word's `\r` switch gives: "clause
(ii) above" from inside the same Section, and "Section 2.06(b)(ii)" from
elsewhere (#1258). That number depends on where the field sits, so it cannot
be computed from the target alone.

## What Changes

- `CROSS_REFERENCE_NUMBERS` gains `'relative'`, which emits
  ` REF <name> \r \h `. `show` stays `number | text` (the #1277 design): a
  relative number is a number form. `docx-core`'s `resolveReferenceNumber`
  takes the position as a new `context` argument
  (`RelativeReferenceContext`), and gains the refusal `relativeStartValue`.
- What Word 16.114 does, measured on 106 probe fields and two created
  documents (`scripts/oracle/word/evidence/issue-1258-word-16.114.json`):
  - `\r` shows the `\w` number less the leading levels whose values the
    target shares with a position, and always keeps the target's own level.
    A part that names level 0 ("Section %1.%2") is kept whole.
  - The position is the last paragraph of the target's own list (its
    `w:numId`) at or before the paragraph holding the field, not the
    field's paragraph. An unnumbered paragraph or table cell after
    "2.03(c)" shows "(b)" for "2.03(b)"; another `w:num` of the same
    definition is another list. With no paragraph of the target's list
    before the field, the number is the full one.
  - A field in a footnote shows the full number, wherever the note is
    anchored.
  - Results by place: another Article "Section 2.03(b)(ii)"; the same
    Article "Section 2.03(b)(ii)"; the same Section "(b)(ii)"; a sibling
    clause "(ii)"; the target's own paragraph "(ii)"; a numbered heading
    from inside it "Section 2.03"; a table cell, numbered or not, as a body
    paragraph in its place.
- Generation refuses a relative reference, at its path:
  - in a footnote when a footnote paragraph is numbered by the target's
    numbering definition (directly, by an instance, or by a style linked to
    a list level or based on one): Word then counts from the footnotes' own
    paragraphs of that list (#1284 evidence), which is not modelled.
  - A level shown at its start value, in the target or at the position, is
    compared at that value (#1284 evidence, 47 fields equal to Word); the
    earlier `relativeStartValue` refusal is removed.
- The creation grammar admits `number="relative"` on `{% xref /%}`. It takes
  no `format`. `create` fails closed where LibreOffice, which renders the
  PDF, numbers the field differently from Word, or Word is unmeasured:
  - `XREF_RELATIVE_ACROSS_LISTS`: a reference to an item of an ordered list
    outside numbered headings must sit before every such list, or after an
    item of its target's own list (a chain of continuing lists) with no
    other such list starting in between. LibreOffice numbers relative to
    the last paragraph of any list of the definition;
  - a relative reference to a clause directly under an Article fails with
    `XREF_FULL_NUMBER_UNDER_ARTICLE`, as a full one does, unless it sits in
    or after that Article's clauses (before the next heading), where Word
    and LibreOffice both show `(a)`. The earlier
    `XREF_RELATIVE_AFTER_ARTICLE_CLAUSES` refusal is removed (#1284).
- Create verification: the lowering and the independent oracle each compute
  relative numbers from the position, the oracle from the source alone (its
  walker keeps each list's last numbered item). The cross-reference check
  compares the `\r` instruction and, for every number reference, the cached
  result with the oracle's number. A new `relativeContext` negative control
  expects the full number for one relative reference. `references.relative`
  counts them, and the CLI summary reads
  `cross-references ok (3 references: 1 number, 1 relative, 1 text; negative controls ok)`.
  The LibreOffice PDF form adds the period after a leading number for `\r`
  as for `\w`.

## Impact

- Affected specs: `docx-generation` (ADDED requirement), `docx-markdoc`
  (ADDED requirement).
- Affected code: `packages/docx-core/src/primitives/numbering.ts`;
  `packages/docx-core/src/generation/` (`types.ts`, `validate-spec.ts`,
  `emit/run.ts`, `emit/emit-context.ts`); `packages/docx-markdoc/src/create/`
  (`validate.ts`, `theme.ts`, `lower.ts`, `oracle.ts`, `create.ts`,
  `cli-create.ts`).
- Import: `docx-markdoc import` restoring `{% xref %}` from REF fields is
  #1260; it must map `\r` to `number="relative"`.
- Compatibility: additive. Specs and sources without relative references
  give the same bytes. The certificate's cross-reference check gains
  `references.relative` and `negativeControls.relativeContext`, and now
  compares number references' cached results with the oracle.
