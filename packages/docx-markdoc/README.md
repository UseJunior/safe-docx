# `@usejunior/docx-markdoc`

Brownfield DOCX authoring as readable clean document states over a hash-pinned
Word source. The redline is deterministic derived output, not canonical input.
This package is an experimental compiler and conversion surface; its Markdoc
syntax and transient comparison-attribution machinery are intentionally kept
out of the general-purpose `@usejunior/docx-core` package.

Install it from npm and inspect the complete CLI surface with:

```bash
npm install @usejunior/docx-markdoc
npx docx-markdoc --help
```

```markdoc
{% source sha256="..." paragraphs=2 /%}

{% change id="_bk_..." fingerprint="sha256:nfkc:..." style="Normal" edit="update-entity-name" format="inherit-source-paragraph" %}
{% before %}
The Old Name.
{% /before %}
{% after %}
The New Name.
{% /after %}
{% /change %}

{% rationale for="update-entity-name" visibility="internal" %}
Use the entity's current legal name.
{% /rationale %}
```

`edit=` names the edit; `id=` is the source paragraph's bookmark. A rationale's
`for=`, an annotation's `edit=`, a requirement's `satisfied-by=` and a
change-set's `edits=` refer to an edit by that name, so name what the edit does
(`add-cure-period`), not the kind of edit. The former spelling (`operation=`,
and `operations=` on `change-set`) was removed after its deprecation window; a
file that still uses it fails validation with `REMOVED_EDIT_ATTRIBUTE` naming
the replacement, so rename the attribute. Import emits only `edit=`.

Compilation verifies the clean before state against the pinned source, applies
the clean after state, and derives native tracked changes with Safe DOCX's
comparison engine. It then proves reject-all equals source and accept-all equals
clean. Inline `ins`/`del` is available only as generated display/export syntax;
models and lawyers author familiar complete sentences.

## External-facing rationale comments

Rationale visibility is required. External-facing rationales become native
comments by default when complete comment identity is available; internal
rationales remain private metadata unless each CLI export uses the deliberately
alarming internal-comment capability. Missing, misspelled, or differently cased
visibility fails validation rather than guessing.

```markdoc
{% rationale for="update-entity-name" visibility="external-facing" %}
The revised name matches the synthetic review record.
{% /rationale %}
```

Canonical Markdoc can carry replayable revision and comment identity. One build
date governs both revisions and comments; omit it to use one UTC instant captured
at compile time, or pin it for reproducible fixtures:

```markdoc
{% compilation
   revision-author="Revision Author"
   comment-author="External Reviewer"
   comment-initials="ER"
   build-date="2026-08-16T14:30:00.000Z"
   external-comments="include"
/%}
```

The CLI can perform the whole workflow without a JavaScript wrapper:

```bash
# Preserve the caller's original and create the bookmark-anchored source plus
# the initial readable revision file. Pandoc is not involved.
docx-markdoc import source.docx anchored.docx revision.mdoc

# Optional fast lint/editor/CI feedback. Compile runs this same validation
# automatically before it mutates or compares any document.
docx-markdoc validate revision.mdoc

# Compile the edited revision file. External-facing rationales are included by
# default and the filename and CLI output warn when comments are present.
docx-markdoc compile anchored.docx revision.mdoc output/

# Suppress external-facing comments even if the Markdoc requests them. The CLI
# override wins and warns that external rationales were present but omitted.
docx-markdoc compile anchored.docx revision.mdoc output/ --no-external-comments
```

Tracked replacements use bounded readable-whitespace grouping by default and
there is no grouping selector. It may copy only identical ordinary U+0020 bridge runs into
both sides of adjacent replacement fragments. It never absorbs common words,
punctuation, tabs, line breaks, protected structure, or incompatible formatting.
The verification certificate records the fixed policy and default provenance,
grouped-chain count, and copied-space-token count. The exact-token minimal hunk
set is still validated before grouping; callers using the short-lived old
`revision-grouping` declaration, `revisionGrouping` API option, or
`--revision-grouping` flag must remove it. The exported
`RevisionGroupingPolicy` and `RevisionGroupingSource` types were also removed;
certificate consumers can use the fixed literal fields in
`RevisionGroupingReport`.

Every CLI output path must be new, including import, edit export, and comment
conversion paths. Existing files and symlinks are refused. Compilation reserves
all output files before writing and removes files created by that invocation if
a handled error occurs. Separate paths are not a crash-atomic transaction: a
process or machine crash can leave partial files. Use a new output directory for
each build and check the command exit status before consuming its artifacts.

An explicit `before` state must exactly match the pinned source paragraph;
compilation rejects a false or empty state instead of silently correcting it.
Legacy `replace-source` and `delete-source` syntax omits that state, so compile
it against the pinned DOCX before calling `exportEditPairs(result.ir)`.
Standalone `export-edits` refuses unresolved source-only edits.

Operative text must use plain text or the declared `run-format` syntax.
Markdown links, emphasis, and arbitrary nested tags are rejected instead of
silently losing their meaning. Paragraph changes use one before/after text
block. Insertions may contain multiple paragraphs separated by blank lines;
those boundaries are preserved in the DOCX. Rationale, requirement, and waiver
bodies likewise use one plain-text block; multiple Markdown blocks are rejected
rather than concatenated.

`anchored.docx` differs from `source.docx` in content only where Safe DOCX had
to add stable `_bk_*` paragraph bookmarks; its ZIP entries also all carry one
fixed date, so importing the same `source.docx` again reproduces the same
`anchored.docx` and hash. The Markdoc hash and paragraph IDs target that
anchored copy, so later compilation is stateless and never needs an editing
session. The caller's original bytes remain untouched.

## Existing headers and footers

Import also inventories each relationship-selected physical header or footer
once. Its opaque `story` ID represents the complete sorted set of section
selectors that share that part; it is not a package filename. Admitted ordinary
paragraphs receive anchors in the separate `anchored.docx` copy. For example:

```markdoc
{% story id="story-header-…" kind="header" bindings="0:default,1:default" fingerprint="sha256:…" paragraphs=1 readonly=0 /%}

{% change story="story-header-…" id="_bk_…" fingerprint="sha256:…" style="Header" edit="update-date" format="inherit-source-paragraph" %}
{% before %}Draft of September 17, 2026{% /before %}
{% after %}Draft of September 18, 2026{% /after %}
{% /change %}
```

Unsupported paragraphs remain visible, in physical story order, as non-operative
`readonly` blocks. Their text, ordinal, reason, and whole-paragraph fingerprint
are pinned to the source, but they have no Markdoc anchor:

```markdoc
{% readonly story="story-header-…" ordinal=0 fingerprint="sha256:…" reason="drawing" %}
Company logo
{% /readonly %}
```

The `story` attribute also works on `insert-before`, `insert-after`, and
`delete-source`; without it, those tags still target the main body. An edit to
a shared story affects every listed selector. The compiler requires the exact
imported binding closure and source fingerprint, rejects body/other-story
anchors, and certifies accept-all and reject-all text, formatting, scaffold,
relationships, bindings, and unresolved revisions for each edited story.
Existing physical table-cell paragraphs follow the same cell-boundary and
trailing-paragraph rules as body edits. Field results and instructions remain
preserved; ordinary text beside them can be edited.

This is bounded paragraph authoring, not header/footer creation or structural
editing. Markdoc cannot add, remove, rebind, or partly alias a story; change
section selectors, tables, drawings, fields, content controls, or nested text
boxes; or materialize Word comments on side-story edits. Paragraphs containing
relationship-backed or unsupported content are read-only and have no operative
Markdoc anchor; an attempted edit on an existing anchor there reports
`UNSUPPORTED_STORY_CONTENT`. Unselected orphan parts remain untouched. Internal rationale
may still accompany an edit without becoming a Word comment.

## Template-backed greenfield forms

`compile-greenfield` creates a new clean form in an existing one-section house
style. The template supplies styles, page setup, package metadata, and any
already-wired headers or footers; the tag-free Markdoc supplies every body
paragraph. Template placeholder body content is discarded and is never treated
as a legal-text reject state, so this command emits `clean.docx` and
`verification.json` but no redline.

```bash
docx-markdoc compile-greenfield house-template.docx form.mdoc new-output/
docx-markdoc compile-greenfield house-template.docx form.mdoc new-output/ \
  --style-profile house-styles.json
```

The body grammar admits ATX headings and plain paragraphs only. Inline emphasis,
links, code, lists, tables, block quotes, thematic breaks, Markdoc tags, and
YAML frontmatter fail with an actionable diagnostic. HTML is never interpreted:
angle-bracket text remains literal and is XML-escaped. Literal form content
such as `Name: _____`, `A & B`, and `#not-a-heading` remains plain text. A line
containing only `_____` is parsed as a thematic break and is therefore refused;
put the blank beside a label instead.

Without a profile, body paragraphs resolve to `Normal` and headings to
`Heading1` through `Heading6`. A profile names existing style IDs explicitly:

```json
{
  "bodyStyleId": "HouseBody",
  "headingStyleIds": { "1": "HouseTitle", "2": "HouseSubhead" }
}
```

The compiler admits exactly one final direct body-level section-properties
element and no pre-existing revisions in the main document or selected revision
stories. It does not create missing header/footer relationships. Every package
part outside `word/document.xml` retains identical uncompressed bytes. The
certificate binds the exact template, Markdoc, optional profile, and output
hashes; records the resolved styles and body inventory; and inventories the
preserved section/story bindings and unchanged parts. Template document
properties and statistics are deliberately preserved and can therefore remain
stale in this first bounded version.

Internal rationale never becomes a comment merely because it is present in
Markdoc. Each internal-review export requires both the alarming capability and
an explicit separate path:

```bash
docx-markdoc compile anchored.docx revision.mdoc output/ \
  --dangerously-include-internal-comments \
  --internal-output review.docx
```

The actual filename is forced to end in `INTERNAL COMMENTS INCLUDED.docx`, even
when the requested basename must be truncated to fit the filesystem limit.

Each selected rationale becomes one native root Word comment around the
tracked edit attributable to its edit name. Insertions and replacements prefer
inserted text; deletion-only edits remain anchored to deleted tracked markup;
multi-paragraph edits receive one bounded range. Accept-all and reject-all keep
the comment components balanced, collapsing the range at the edit boundary
when its tracked anchor disappears.

## Delivery completeness

Exact DOCX replay and drafting completeness are separate claims. A required
drafting decision names the edit or edits that satisfy it:

```markdoc
{% requirement id="remove-obsolete-block" satisfied-by="remove-heading,remove-body" mode="all" %}
Remove the obsolete block without leaving a heading or signature remnant.
{% /requirement %}

{% change-set id="remove-obsolete-block" edits="remove-heading,remove-body" atomic=true /%}
{% assert id="obsolete-label-absent" kind="absent" text="OBSOLETE LABEL" /%}
```

An incomplete atomic change set fails before mutation, so its surviving members
cannot apply alone. An unsatisfied requirement or failed `present`/`absent`
assertion does not falsify a successful accept/reject projection; instead it
sets `draftCompletenessPassed` and `deliveryReady` to `false`. The aggregate
field `certificate.passed` is deliberately conservative and is true only when
`deliveryReady` is true. Exact accept/reject replay is reported solely by
`projectionPassed`. Consumers that previously treated `passed` as projection-
only evidence MUST migrate to `projectionPassed`; consumers gating publication
on `passed` remain fail-safe. The API may return diagnostic clean/redline
buffers for an incomplete draft, but they MUST NOT be published when `passed`
or `deliveryReady` is false. A projection failure still throws
`VERIFICATION_FAILED`; an incomplete draft returns its distinct completeness
report so callers can repair it.

A requirement may be waived only with an explicit authority and non-empty
human-supplied reason. The package records these values verbatim and does not
infer authority or create waivers:

```markdoc
{% waiver for="remove-obsolete-block" authority="reviewing-lawyer" %}
Expressly deferred to the next instrument.
{% /waiver %}
```

These tags describe general document-workflow invariants. They intentionally do
not encode document domains, clause types, parties, or legal conclusions.

Whole-paragraph changes keep both clean states explicit:

```markdoc
{% change id="_bk_..." fingerprint="..." style="Normal" edit="revise-provision" format="inherit-source-paragraph" %}
{% before %}The original paragraph.{% /before %}
{% after %}The complete revised paragraph.{% /after %}
{% /change %}
```

When one paragraph generates more than one independently formatted span, keep
the intent inline with the clean authored text:

```markdoc
{% after %}
Dates: {% run-format underline="single" highlight="yellow" %}____{% /run-format %}
and {% run-format underline="single" highlight="yellow" %}____{% /run-format %}.
{% /after %}
```

Inline spans are stored as exact revised-text offsets, so repeated text is not
resolved by search or occurrence counting. Each span must lie wholly within one
generated replacement hunk; unchanged, empty, nested, overlapping, and
cross-hunk scopes fail before document mutation.

`run-format` is intentionally limited to generated replacement text. To change
direct formatting on text retained from the source, wrap the exact common
occurrence with `retain-format`:

```markdoc
{% after %}Status: {% retain-format highlight="none" underline="single" %}Complete{% /retain-format %}{% /after %}
```

The retained-text vocabulary is closed: `highlight="yellow" | "none"` and
`underline="single" | "none"`; omission preserves the source property. Each
non-empty declaration must map wholly to common aligned text and one coalesced
source formatting class. Generated, deleted, mixed-format, nested, overlapping,
unknown, and deterministic no-op scopes fail before mutation. Authored offsets,
not substring search, distinguish repeated visible strings. `none` removes only
an admitted direct property; formatting supplied solely by a character style is
not silently overridden and therefore remains a deterministic no-op.

Retained formatting is supported by ordinary admitted paragraph edits,
including paragraphs in existing physical table cells. It does not broaden
table topology or cross fields, hyperlinks, content controls, embedded objects,
or other unsupported run containers. Tracked output uses native `w:rPrChange`;
the certificate reports declared spans, changed properties, physical property
ranges, complete character coverage, exact interval text, the declared clean
property state, and any forbidden text-revision overlap. Any mismatch blocks
delivery with `NON_COMMON_RETAINED_SCOPE`.

Text replacement and deletion of an existing numbered paragraph preserve its
source `w:pPr`, including paragraph style, `w:numPr`, level, indentation, and
list identity. Inserting a numbered item requires an explicit existing
paragraph as the formatting source so the compiler never guesses between an
adjacent list level and a list terminator:

```markdoc
{% insert-after anchor="_bk_current_item" edit="add-item" style-source="_bk_current_item" %}
{% after %}The new numbered item.{% /after %}
{% /insert-after %}
```

This supports editing text within existing list topology; changing numbering
definitions, restarting a list, or changing list levels remains out of scope.

Anchored text replacement, insertion, and deletion are supported inside an
existing table cell. Inserted paragraphs must inherit formatting from that same
physical cell—a nested table's cells are distinct from the enclosing cell—and
the compiler refuses any deletion set that would leave the cell without a
trailing direct paragraph. Replace the retained paragraph instead of
combining deletion and insertion when a cell contains only one paragraph.
Vertical-merge continuation cells remain non-editable because their content is
not independently visible. These paragraph operations preserve row, cell, grid,
and merge topology.

Simple rectangular body tables also admit whole-row insertion and deletion:

```markdoc
{% insert-table-rows anchor="_bk_inventory" position="after" edit="add-inventory" %}
{% row %}
{% cell text="Acme Manufacturing, Inc." /%}
{% cell text="Pending" /%}
{% /row %}
{% row %}
{% cell text="Bravo Holdings" /%}
{% cell text="Approved" /%}
{% /row %}
{% /insert-table-rows %}

{% delete-table-row anchor="_bk_obsolete" edit="remove-obsolete" /%}
```

Rows are inserted in authored order. `position="after"` chains each new row
after the preceding inserted row; `position="before"` keeps the source row as
the anchor. Cell text is an exact single-line string (including leading or
trailing spaces); tabs and line breaks are rejected. The compiler preflights
the entire structural batch and only admits the bounded docx-core rectangular
topology—no merged, nested, offset, wrapped, or final-row deletion cases. Its
certificate additionally proves source/reject and clean/accept table topology
and zero unresolved row revisions. This is a Markdoc/compiler adapter over the
public docx-core primitives; it does not add an MCP row-editing tool.
If inserted rows duplicate adjacent source rows exactly, the structural build
can still compile, but an attached rationale may be refused as ambiguous rather
than being placed on a potentially wrong physical duplicate. Omit that
rationale or make the authored row text distinguishable.

Mixed-format paragraphs are edited surgically: unchanged spans retain their
source runs, and a replacement inherits the one formatting class occupied by
the deleted source span. If an insertion lands exactly between incompatible
formats, or a replacement crosses formats, compilation fails closed. The
author may resolve that ambiguity by naming one unique source substring:

```markdoc
{% change id="_bk_..." fingerprint="..." style="Normal" edit="revise-defined-term" format="inherit-source-paragraph" format-source="Defined Term" %}
{% before %}The Defined Term applies.{% /before %}
{% after %}The Revised Term applies.{% /after %}
{% /change %}
```

`format-source` is formatting-only and document-domain-neutral. It must match
exactly once and occupy one coalesced formatting class; it does not change the
before/after text or relax source verification. Deleting a mixed-format
paragraph requires no formatting choice and therefore remains admitted.

Verification separately checks semantic formatting fidelity from the pinned
source to reject-all and from clean output to accept-all. Both checks tolerate
harmless run fragmentation, include at most eight property-level divergences in
the certificate, and gate projection and delivery success. They do not infer
that new text should be formatted merely because it resembles a blank, date,
signature line, or other domain convention.
The same attribute applies to `insert-before` and `insert-after` when their
anchor or `style-source` paragraph has mixed character formatting; without it,
such an insertion fails closed rather than choosing the longest source run.

`format-source` only selects the inherited source template. It never authors
new formatting. One generated replacement hunk may instead declare an explicit
additive overlay using the closed `underline="single"` and
`highlight="yellow"` vocabulary:

```markdoc
{% change id="_bk_..." fingerprint="..." style="Normal" edit="blank-date" format="inherit-source-paragraph" underline="single" highlight="yellow" %}
{% before %}2026-08-12{% /before %}
{% after %}________________{% /after %}
{% /change %}
```

Only the generated replacement receives those direct properties. All
undeclared properties remain inherited from the selected source run. A
run-format declaration is rejected before mutation if its edit produces
zero or multiple generated text hunks; split the work into separate
source-anchored edits instead. An inserted paragraph is one zero-width
source hunk and may use the same overlay.

The canonical Markdoc is compact. `inspectMarkdocSource` generates normalized
formatting detail for selected paragraphs when an edit needs it. With no IDs it
returns the full document; with `paragraphIds` it returns only those anchors.
Adjacent physical Word runs with identical direct run properties are coalesced,
while `start`, `end`, `paragraphPropertySha256`, `runPropertySha256`, and
`sourceRunCount` keep
the readable view tied to the source formatting without copying raw OOXML into
canonical Markdoc. Inspection output is diagnostic and cannot be compiled.

## Structural diagnostics

When an anchored source is available, `validateMarkdocAgainstSource` and
compile preflight run the same deterministic validators used by DOCX insertion
tools. Diagnostics have stable codes, severity, operation/anchor identity,
structural evidence, and a corrective anchor when one is unambiguous.

The registry detects parent/child slicing, list-level mismatch, foreign
numbering inserted into a continuous list, and incomplete bonded paragraph
pairs. Parent/child slicing is checked for both `BEFORE` and `AFTER`
placement. A run-in heading (a deterministic heading whose paragraph mark is a
Word style separator, `w:specVanish`) that is repeatedly followed by the same
body style (for example, NVCA `Heading2` followed by `HeadingPara2`) is treated
as a two-paragraph structural unit: both halves need distinct style sources,
each heading must land immediately before its body in the insertion slot, and
operation order is checked separately for `BEFORE` and `AFTER`. An ordinary
heading followed by `Normal` text is not bonded. Ambiguous repeated follower
styles fail with an explicit diagnostic.
No title-case or legal-content regex is used as structural authority.

Junior Harness retry state, warn-once policy, Aspose adapters, legal section
classifiers, and content-specific remediation remain application concerns and
are intentionally not ported.

Leading or trailing spaces in operative text must be written as `&#32;` because
Markdown treats ordinary boundary spaces as syntax. The importer does this
automatically, including escaping literal `&` first, so import and replay remain
exact. Ordinary interior spaces stay ordinary and readable.

`exportAdjacentRevisionPairs` compares two canonical states over the same
hash-pinned source. It copies caller-supplied labels verbatim and never infers an
actor, cause, authorization, privilege status, de-identification status, or
training eligibility; those remain downstream responsibilities.

## Generic Markdoc → DocumentSpec engine

`createMarkdocxRenderer` lowers a Markdoc AST to `@usejunior/docx-core`
`DocumentSpec` blocks. Domain conventions are supplied through its seams, not
built into it: a `Theme` (paragraph and run styling, list levels, field runs),
block and inline tag plugins, a `resolveField` callback, and a
`transformBlock` hook.

```ts
import { renderMarkdocxToDocx } from '@usejunior/docx-markdoc';

const docx = await renderMarkdocxToDocx('# Title\n\nA **bold** word.\n\n1. one');
```

The engine is deliberately lenient:

- links keep their text and lose the hyperlink;
- code spans render as plain text;
- soft and hard breaks render as spaces unless a plugin asks for line breaks;
- a paragraph with no runs renders nothing (whitespace text is not trimmed).

A node or tag no seam handles throws `MarkdocxUnhandledNodeError` rather than
being dropped.

## Creating a new document

`docx-markdoc create` builds a new Word document from Markdoc, with no
template:

```bash
docx-markdoc create consent.mdoc outbound/draft --replace
# created consent.docx: 26 paragraphs, 2 section(s); readback ok (negative control ok);
# footers ok (negative control ok); deterministic; brownfield ok (26 anchored); pdf passed (2 pages)
```

It writes four files:

- `consent.docx`;
- `consent.txt`, read back from the DOCX and never from the source;
- `consent.pdf`, when LibreOffice and `pdftotext` are installed;
- `consent.verification.json`.

Each output must be new unless you pass `--replace`. Outputs are renamed into
place only after every check passes. Use `--no-pdf` to skip the PDF, or
`--require-pdf` to treat missing tools as a failure. `--style-profile
house.json` overrides any of `font`, `sizePt`, `spacingAfterPt`,
`lineSpacing`, `marginsIn`, `titleSizePt`, `signatureTabIn` and `justify`.
The default is Times New Roman 11pt on all four font channels, 8pt after,
1.15 lines and 1" margins.

```markdoc
---
title: Unanimous Written Consent of the Board of Directors
page-numbers: true
---

# ACME WIDGETS INC.

{% center %}**Unanimous Written Consent of the Board of Directors**{% /center %}

The directors of Acme Widgets Inc. (the **"Company"**) adopt these resolutions effective [Effective Date].

## Approval of the Plan

1. RESOLVED, that the Widget Plan is *approved*.
   1. The Plan reserves [Number] shares.

{% table widths="40,60" %}
* Holder
* Shares
---
* [Holder One]
* 1,000
{% /table %}

> The officers may execute any certificate described in these resolutions.

{% legend %}[Remainder of page intentionally left blank; signature page follows.]{% /legend %}

{% section footer="[Signature Page to Board Consent]" /%}

{% signer name="Jane Roe, Director" date="Date: ____________" /%}
```

The grammar is closed. Anything else fails with a line number before any
output is written: links, images, code, `---`, HTML, unknown tags or
attributes, and headings below `###`.

- `[...]` anywhere is a highlighted fill-in, with nesting allowed. Wrap
  literal brackets in `{% literal %}…{% /literal %}`; a legend is never
  highlighted.
- Ordered lists get real `1.` / `(a)` / `(i)` numbering, and each list starts
  at its first marker.
- A line ending in `\` is a line break.
- `{% page-break /%}` starts the next block on a new page.
- `{% section %}` starts a next-page section. With no `footer` or
  `page-numbers` attribute, the section keeps the previous section's footer.

### Moving from per-matter pseudo-HTML `.mdoc`

| Old convention | Markdoc |
|---|---|
| `<center>text</center>` | `{% center %}text{% /center %}` |
| `<legend>text</legend>` | `{% legend %}text{% /legend %}` |
| `<signer>Name, Title \| Date: ___</signer>` | `{% signer name="Name, Title" date="Date: ___" /%}` |
| `<!-- pagebreak -->` | `{% page-break /%}` |
| `<!-- page-numbers -->` | frontmatter `page-numbers: true` |
| `<!-- section: x footer="…" -->` | `{% section footer="…" /%}` |
| `## 1. Heading` with a literal number, `(a) text` | `## Heading` plus an ordered list (real numbering) |
| `document_id:` frontmatter | `title:` / `author:` / `date:` |

Leftover pseudo-HTML fails with `LEGACY_MARKUP`, and the error names the tag
to use instead.

The `create` command sits on the generic engine above: a closed-grammar
validator, a house theme, tag plugins and a section driver. The
template-backed `compile-greenfield` command is unchanged.
