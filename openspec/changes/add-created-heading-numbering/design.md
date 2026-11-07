# Design: numbered headings in created documents

## Opt-in: frontmatter, not a per-heading attribute

Heading numbering is a property of the whole document. Every Article and
Section of one agreement uses the same scheme, and a Section number depends
on all the Articles before it. A per-heading attribute would allow mixed
documents in which a Word user's new Heading 2 paragraph is numbered while
an authored one is not. The style link also numbers every paragraph of a
Heading style, so a per-heading opt-out would need `w:numId="0"` on that
paragraph, which docx-core generation does not emit. So the opt-in is one
frontmatter key, `heading-numbers`, whose value names a closed scheme
(`legal` for now).

## Lists under a numbered heading: levels of the heading definition

PR #1271 left a choice for lists under a numbered heading. (a) The lists
become deeper levels of the heading's multilevel definition, restarting per
heading. (b) The lists stay on the separate ordered definition. This change
takes (a), for these reasons:

- Legal clauses restart under each Section ("Section 1.01(a)", then
  "Section 1.02(a)"). Under (a), Word restarts them through the default
  `w:lvlRestart`. Under (b), the #1252 continuation rule would make the
  clauses of Section 1.02 continue from those of Section 1.01.
- Under (a), a full-context REF names its Section: Word shows
  "Section 1.01(b)(i)(A)". Under (b), it shows "2(b)" with no Section, and
  LibreOffice shows "2.(b)" (issue-1236-word-16.114.json, `REF create_2b`).
  None of the heading definition's level texts end with a period, so Word
  and LibreOffice agree on every reference to a heading, or to a clause
  inside a Section (issue-1236 `REF legal_s206b`; this change's PDF word
  check).
- Word for Mac 16.114 confirms the shape end to end
  (issue-1250-word-16.114.json). Before any edit, the after-update REF
  results equal create's cached results. Inserting a Heading 2 paragraph in
  Article II renumbers that Article's later Sections and every reference to
  them and their clauses, and leaves other Articles unchanged. An inserted
  Heading 1 paragraph becomes the next Article, and the Sections after it
  restart.

Under (a), the projections keep counting per definition, with each
override applied at first use. Heading paragraphs carry no `list` of their
own: `lower.ts` maps each linked style to its level. The `#1252` continue
and restart rules still apply to lists outside numbered headings.

## Clauses directly under an Article

An ordered list may follow an Article heading before any Section. Two
measured behaviours limit it:

- Word counts a level-2 paragraph that skips level 1 as if level 1 were at
  its start value, so the Article's next Section reads "Section 1.02". Both
  Word and LibreOffice do this (control `skippedSectionLevel`). create
  refuses such a Section with `SECTION_AFTER_ARTICLE_CLAUSES`.
- A full-context REF to such a clause reads "ARTICLE II(a)" in Word, which
  passes over the start-value Section level (#1269). LibreOffice reads
  "Section 2.01(a)" (control `articleClauseFullContext`). The PDF would then
  name a Section that does not exist. create admits only the paragraph form
  (`(a)`) and refuses the full form with `XREF_FULL_NUMBER_UNDER_ARTICLE`.

## List markers under a heading

Markdoc ordered lists have numeric markers only. Under a numbered heading,
`1.` renders as `(a)`. The first list under a heading must start at 1, and a
later list under the same heading must continue the one before it. This
keeps the rule that the numbers Word shows equal the source markers. The
source oracle and the read-back checks rely on that rule (#1252). A restart
within one Section is refused (`HEADING_LIST_START`) rather than encoded
with an override.
