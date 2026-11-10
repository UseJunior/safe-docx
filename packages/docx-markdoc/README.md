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
npx docx-markdoc create --help
```

`--help` or `-h` on any subcommand prints its usage, arguments, options and
outputs and exits 0. `create --help` also lists every frontmatter key with its
values, the `{% section %}` attributes and the block and inline tags with their
attributes, read from the grammar the build enforces. A command line the CLI
cannot run (an unknown command or option, a missing or extra argument, an
option without its value, flags that cannot be combined) prints one
`ERROR CLI_USAGE: <message> Run 'docx-markdoc <command> --help' for usage.`
line to stderr and exits 1. A path that cannot be read or written prints one
`ERROR <code>: <message>` line, such as `ERROR ENOENT: …`. Neither prints a
stack trace unless `DEBUG` is set; an unexpected internal error still prints
its stack.

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
# automatically before it mutates or compares any document. (A creation
# source for `create` is linted with `validate --create`; see below.)
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

### Cross-references in imported documents

Import restores a Word cross-reference (a REF field to a bookmarked
paragraph) as an inline tag over the result Word last showed, in body
paragraphs, table cells, footnotes and comments:

```markdoc
See {% xref to="price-adjustment" %}Section 1.01(b)(i){% /xref %}.
The {% xref to="delivery-terms" show="text" %}Delivery Terms{% /xref %} section governs.
Under {% xref bookmark="_Ref201812345" number="paragraph" hyperlink=false %}(i){% /xref %}, …
```

` REF <name> \w \h ` is the full number, ` \n ` is `number="paragraph"`,
` \r ` is `number="relative"`, and no number switch is `show="text"`. A field without `\h` adds
`hyperlink=false`. The tag names its target with `to="id"` when the bookmark
is the one `create` writes for that id (hyphens turned into underscores),
and keeps the bookmark name with `bookmark="name"` otherwise, as for Word's
hidden `_Ref…` bookmarks. Both name the same field.

Compile writes each tag back as the source's field, with the same
instruction, bookmark and target. An edit may change the text around a
reference, including words typed right before or after it, but not the
reference itself, and compile does not refresh the field's result: Word does
that when it updates fields. Compile fails before writing anything with:

- `XREF_DRIFT`: a `{% para %}` or `before` state whose tags disagree with the
  source's fields (another target, another form, or a tag removed);
- `XREF_EDIT_UNSUPPORTED`: an `after` state that changes, adds or drops a
  reference, or uses `run-format` in a paragraph holding one, or an edit of
  a paragraph whose REF marker shares its run with text outside the field
  (Word writes each marker in a run of its own);
- `XREF_SOURCE_UNSUPPORTED`: an edit of a paragraph, or any rewrite of a
  footnote or comment, holding a REF field that import kept as text;
- `XREF_TARGET_MISSING`: a note's reference to no bookmarked paragraph, or an
  edit that deletes a paragraph a reference points at;
- `XREF_PROJECTION_FAILED`: output whose REF fields do not match the
  source's;
- `INVALID_MARKDOC` with `XREF_UNSUPPORTED_LOCATION`, for a tag in an
  inserted paragraph or a header or footer paragraph, or with
  `INVALID_CROSS_REFERENCE`, for a malformed tag.

A REF field the tag cannot carry stays text, as before:

- a switch other than one of `\w`, `\n` or `\r` and `\h`, such as `\p` or
  `\* MERGEFORMAT`;
- a bookmark that is missing, repeated, or marks no paragraph;
- a nested or unterminated field, or one with no result;
- a result that is empty or holds a tab, a tracked change or other
  non-text content.

`ImportResult.crossReferences` counts the restored fields and lists those
kept as text, with a reason, and the CLI prints a
`warning XREF_KEPT_AS_TEXT` line for each. An edit of a paragraph that holds
one fails with `XREF_SOURCE_UNSUPPORTED` rather than flattening the field.

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

Insertions consume their formatting donors before source edits are applied,
while keeping the relative order of insertion declarations. An insertion cannot
use a paragraph deleted by the same compilation as its anchor or style donor;
preflight rejects that dependency with `CONFLICTING_INSERT_DEPENDENCY`.

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
# footers ok (negative control ok); deterministic; brownfield ok (26 anchored);
# round trip ok (26 paragraphs; negative controls ok); pdf passed (2 pages); pdf words ok (201 source words)
```

Lint a creation source without building it with `validate --create`:

```bash
docx-markdoc validate --create consent.mdoc
docx-markdoc validate --create consent.mdoc --style-profile house.json
```

It runs the checks `create` runs before rendering anything: the source
characters, the frontmatter, the closed tag grammar, the running-text keys and
the section structure. It prints the same `ERROR <code>: <message> (line N)`
lines `create` would and exits 1 on any problem, or prints a JSON summary
(sections, blocks and the parsed frontmatter) and exits 0. It writes nothing:
no DOCX, no output directory, no lock. Plain `validate` reads only brownfield
Markdoc from `import` and does not detect creation sources, so its results
are unchanged; a creation source fails it with `tag-undefined` and
`MISSING_SOURCE`.

`create` writes four files:

- `consent.docx`;
- `consent.txt`, read back from the DOCX and never from the source;
- `consent.pdf`, when LibreOffice and `pdftotext` are installed;
- `consent.verification.json`.

Outputs are staged privately and published together only after every check
passes; any failure while publishing restores what was there before. If an
original cannot be put back, it is kept, never deleted, in a
`.<stem>.create-recovery-…` directory that the error names. Only one `create`
run may publish to the same output directory and stem at a time; a second run
fails with `CREATION_LOCKED`. If no run is active, delete the
`.<stem>.create.lock` file the error names. A rollback removes an output only
if, when checked, it is still the file this run staged. The check and the
removal are two steps, so the guarantee is complete against other `create`
runs, which the lock serializes, but not against an unrelated program
replacing the file in that instant. Without
`--replace`, the build refuses if any of the four files already exists,
including a PDF from an earlier build, and it never overwrites a file that
appears while it runs. With `--replace`, the outputs are swapped in together,
and a stale artifact this build did not produce (a PDF under `--no-pdf`) is
removed.

`--replace` rebuilds over `<stem>.docx` only when it is the DOCX the last
build certified: its SHA-256 must equal `docxSha256` in a passing
`<stem>.verification.json`. If someone edited the DOCX after the build, or
the certificate is missing or unreadable, the build fails with
`CREATION_OUTPUT_EDITED` and changes nothing. The DOCX is checked again when
it is moved aside at publication, so an edit saved during the build is caught
too. To rebuild anyway, pass `--dangerously-overwrite-edited-docx`. It keeps
the displaced DOCX, byte for byte, in
`.<stem>.create-overwritten-<uuid>/<stem>.docx` and names that path in its
output. These checks see edits saved before publication moves the DOCX aside;
a program still writing to the file after that point writes into the kept
copy. To keep the edits instead, bring them into the source with
[`docx-markdoc pull`](#pulling-word-edits-back-into-the-source): after a
complete pull, `--replace` accepts the edited DOCX when it builds exactly the
pulled source.

An output that would overwrite an input, including through a
symlinked directory or a hard link, is refused. Use `--no-pdf` to skip the PDF, or
`--require-pdf` to treat missing tools as a failure. `--style-profile
house.json` overrides any of `font`, `sizePt`, `spacingAfterPt`,
`lineSpacing`, `marginsIn`, `titleSizePt`, `signatureTabIn` and `justify`.
The default is Times New Roman 11pt on all four font channels, 8pt after,
1.15 lines and 1" margins.

Before anything is published, every build checks its own output. Besides the
package, determinism, read-back and brownfield-import checks:

- **Round trip.** The DOCX is re-imported with `docx-markdoc import`, and its
  body, header and footer paragraphs are compared with text read straight from the
  Markdoc source, not from the document model the build produced. Only
  Unicode NFC and whitespace collapsing are applied. A deleted word,
  paragraph, table cell and footer text must each be detected as negative
  controls. Each mismatch is recorded with its source line and the missing
  and extra words.
- **PDF words.** When a PDF is rendered, its text layer (`pdftotext -raw`)
  must match the source word for word. Generated text is worked out from the
  source, not guessed from its shape: list labels (`1.`, `(a)`, `(i)`,
  bullets) are expected words, and every page break must be explained by a
  place in the source where the page can start, which fixes the page's
  footer and page number and any table header repeated at its top. Anything
  else, missing or extra, fails with `CREATION_PDF_WORDS_MISMATCH`, and so
  does a page break the text cannot pin down, such as a table with empty
  trailing rows followed by a table with the same header. Each footnote
  number is expected where its reference sits, and each note's text is read
  from the foot of the page (a long note may continue at the foot of the
  next); a note must start on the page that holds its reference. LibreOffice
  sometimes exports a justified line without spaces, so the raw text layer
  reads it as one long token. Such a token is split back into words only when
  it spells a run of consecutive source words exactly and the page's
  `pdftotext -layout` text, which places words by glyph position, shows that
  reading spaced in a place the raw text does not (one such place per split
  token); the certificate lists it under `knownGenerated.joinedLines`. A word
  dropped from, added to or moved within that line still fails, unless the
  page's layout text shows the source reading in another place where the raw
  text does not (the evidence is counted per page, not tied to the line). A
  word that holds a dash, such as `re-evaluate`, can wrap right after the
  dash, so the raw text ends one line with `re-` and starts the next with
  `evaluate`. These are rejoined only when the dash token ends its raw line
  and the alignment left exactly the joined word missing at that place; the
  certificate lists them under `knownGenerated.wrappedHyphens`. A stray dash,
  or one whose joined form is not that source word, still fails, and so does
  a word wrapped across a page break or one whose fragment the alignment
  matched to a neighbouring word spelled the same. The certificate's `pdf.words.limitations` states what the comparison cannot
  catch.
- **Footnotes.** Each note read back from `word/footnotes.xml`, and where
  its reference sits, must match the source, with a negative control. The
  round trip re-imports the notes as footnote annotations and compares their
  paragraphs, and where each reference sits (which non-empty body paragraph,
  and the text on either side of it), with the source.
  The text mirror lists the notes after the body.
- **Cross-references.** The read-back reads each REF field as its cached
  number or text. The round trip compares it with the number the source gives its
  target, counted from the source's own lists, or with the target's text as
  the source has it. For a text reference, the check also compares the text
  the bookmark encloses with the target's source text, and the field's cached
  result with that text; its negative control shortens one bookmark by a
  character. A separate check compares
  each field's bookmark name, number switch and position with its
  `{% xref /%}`, and the paragraph each bookmark opens in with the item
  marked with that id. A field that points at another item showing the same
  number, or that sits somewhere else, also fails. LibreOffice recalculates REF fields when it renders the
  PDF and keeps the period that Word drops (`2.(a)(i)`), so the PDF checks
  expect that form.

A check that finds a mismatch publishes nothing and leaves existing outputs,
including an earlier `<stem>.verification.json`, as they were. It writes
`<stem>.failed-verification.json` with every check result and mismatch, and
the error names that file. The next failed build replaces the report and the
next successful build removes it. Missing PDF tools under `--require-pdf` are
not a mismatch and leave no report.

```markdoc
---
title: Unanimous Written Consent of the Board of Directors
page-numbers: true
---

# ACME WIDGETS INC.

{% center %}**Unanimous Written Consent of the Board of Directors**{% /center %}

The directors of Acme Widgets Inc. (the **"Company"**) adopt these resolutions effective {% fill %}Effective Date{% /fill %}.

## Approval of the Plan

1. RESOLVED, that the Widget Plan is *approved*.
   1. The Plan reserves {% fill %}Number{% /fill %} shares.

{% table widths="40,60" %}
* Holder
* Shares
---
* {% fill %}Holder One{% /fill %}
* 1,000
{% /table %}

> The officers may execute any certificate described in these resolutions.

{% legend %}[Remainder of page intentionally left blank; signature page follows.]{% /legend %}

{% section footer="[Signature Page to Board Consent]" /%}

{% signer name="Jane Roe, Director" date="Date: ____________" /%}
```

The grammar is closed. Anything else fails with a line number before any
output is written: links, images, code, `---`, HTML (inline tags too, unless
wrapped in `{% literal %}`), unknown tags or attributes, Markdoc parse errors
such as an unclosed tag, and headings below `###`.

- `{% fill %}Effective Date{% /fill %}` is a fill-in. It renders as
  `[Effective Date]`, highlighted; the renderer adds the brackets. Fill-ins
  may nest and may sit inside bold or italic text. A signer's name can hold
  one when written as content:
  `{% signer date="Date: ___" %}{% fill %}Name{% /fill %}, Director{% /signer %}`.
  Signer content is one line of text. A second line, a line break, or a tag
  on its own line after the name fails with `INVALID_SIGNER`.
- `{% u %}Purchase Price{% /u %}` underlines its content (single underline)
  and nothing outside it, so `{% u %}Purchase Price{% /u %}.` leaves the
  period plain. Use it for defined terms where they are defined, run-in
  headings (`Section 2.04` then a tab, then
  `{% u %}Closing Deliveries and Payments{% /u %}.`) and operator words
  (`{% u %}less{% /u %} the Closing Debt Amount`). It nests with bold,
  italic, fill-ins and `{% literal %}`, and takes no attributes. An empty
  `{% u %}` fails with `INVALID_UNDERLINE`; `<u>…</u>` fails as HTML.
- `{% fnref id="price" /%}` places a footnote reference, and a top-level
  `{% footnote id="price" %}See Schedule A.{% /footnote %}` block holds its
  text. Put each block anywhere at the top level, such as after the paragraph
  that references it. A note with several paragraphs puts the tags on their
  own lines and the paragraphs, separated by blank lines, between them. The id
  only pairs a reference with its block: notes are numbered 1, 2, 3 in the
  order of their references. A note may hold bold, italic, `{% u %}`,
  `{% fill %}` and `{% literal %}` text, but no line break, list, table,
  heading or other footnote. Each reference needs exactly one block and each
  block exactly one reference; a reference may sit in a heading, list item,
  quote or table cell, but not inside `{% fill %}` or `{% literal %}`. Errors
  are `INVALID_FOOTNOTE`, `NESTED_FOOTNOTE`, `DUPLICATE_FOOTNOTE_ID`,
  `DUPLICATE_FOOTNOTE_REFERENCE`, `FOOTNOTE_REFERENCE_WITHOUT_BODY` and
  `FOOTNOTE_BODY_WITHOUT_REFERENCE`, each with its line. Markdown `[^1]`
  footnotes are not part of the grammar.
- `{% xref to="escrow-release" /%}` is a cross-reference: a Word REF field
  that shows the number of the list item marked `{% #escrow-release %}` and
  updates when the document is renumbered. Mark the target by ending a
  numbered list item (or a heading, which becomes a bookmark only) with
  `{% #id %}`, where the id is lowercase kebab-case and unique in the
  document. In the output, each id is a Word bookmark with its hyphens turned
  into underscores (`escrow_release`). A longer id than Word's 40-character
  limit keeps 31 characters plus an 8-digit hash. The field shows the full
  number by default, `2(a)(i)`, as Word writes it (the period of `2.` is
  dropped before `(`). `number="paragraph"` shows the item's own number,
  `(i)`. `format="section"` puts `Section ` in front, as plain text. The
  field is a hyperlink to its target (Ctrl-click in Word) and carries the
  number as its cached result, so the document reads correctly before
  anyone updates fields. An xref must name a numbered list item or, with
  `heading-numbers: legal` (below), a numbered heading. An xref may sit in body text, a list item, a quote, a
  table cell or a footnote, but not inside `{% fill %}` or `{% literal %}`.
  Errors are `XREF_UNKNOWN_ID` (naming the missing id),
  `XREF_TARGET_NOT_NUMBERED`, `INVALID_CROSS_REFERENCE`, `INVALID_ID`,
  `ID_PLACEMENT`, `DUPLICATE_ID` and `ID_COLLISION`, each with its line.
- `{% xref to="adjustment-b-ii" number="relative" /%}` shows the number
  relative to where the xref sits: Word's `\r` switch
  (` REF adjustment_b_ii \r \h `). It is the full number less the leading
  levels the target shares with that place, and the target's own level is
  always kept. From inside `Section 2.02(a)` it reads `(b)(ii)`, from
  `2.02(b)(i)` or the target itself `(ii)`, and from `Section 2.03(a)` or
  another Article `Section 2.02(b)(ii)`. Word measures the place from the
  last numbered paragraph of the target's own list at or before the xref's
  paragraph, not from the xref's paragraph. So a plain paragraph or table
  cell under `Section 2.02` reads `(b)`, and an xref under the headings to
  an item of a list before them reads `(b)` when that list last numbered
  `2(b)`. In a footnote the number is full. When the document is
  renumbered, the field follows once fields are updated (measured in Word
  16.114, `scripts/oracle/word/evidence/issue-1258-word-16.114.json`).
  `number="relative"` takes no `format`. LibreOffice, which renders the PDF,
  numbers some places differently, so these fail with their line:
  - `XREF_RELATIVE_ACROSS_LISTS`: to an item of an ordered list outside
    numbered headings, the xref must sit before every such list, or after an
    item of its target's own list (lists that continue each other count as
    one), with no other list starting in between;
  - `XREF_FULL_NUMBER_UNDER_ARTICLE`: to a clause placed directly under an
    Article, the xref must sit in or after that Article's clauses, before
    the next heading, where both show `(a)`; elsewhere Word shows
    `ARTICLE II(a)` and LibreOffice `Section 2.01(a)`. Relative xrefs to
    other targets may sit among such clauses (measured in
    `scripts/oracle/word/evidence/issue-1284-word-16.114.json`).
- `{% xref to="purchase-price-adjustment" show="text" /%}` shows the target's
  text instead of its number. This is a REF field with no number switch
  (` REF purchase_price_adjustment \h `), the field Word's Insert >
  Cross-reference writes for "Bookmark text". It shows the text of the heading
  or list item without its number, so a text reference to
  `Section 1.01 Purchase Price Adjustment` shows `Purchase Price Adjustment`.
  Footnote reference marks are left out too, and a fill keeps its brackets.
  The target may be any heading or list item with an id, numbered or not.
  Word copies the target's own formatting into the result, keeping an
  italic word italic and a fill highlighted, so the cached result does the
  same. `show="text"` takes no `number` or `format`. It cannot sit inside
  bold, italic or `{% u %}`, because Word drops that formatting when it
  updates the field (`INVALID_CROSS_REFERENCE`). In a bold table header row
  it is not bolded. A text target that holds an xref or a line break, or has
  no text, fails with `XREF_TEXT_TARGET_UNSUPPORTED`. When the heading is
  reworded in Word, the reference follows once fields are updated, with two
  exceptions measured in Word 16.114
  (`scripts/oracle/word/evidence/issue-1259-word-16.114.json`). The bookmark
  covers the heading's text but stops before its paragraph mark, the same
  extent Word gives a heading of its own:
  - Text typed at the start of the heading, or anywhere inside it, stays in
    the bookmark.
  - Text typed at the very end of the heading lands after the bookmark, so
    the reference keeps the old text. Replacing the heading's last word
    does the same: "Purchase Price Adjustment" edited to "Purchase Price
    True-Up" leaves the reference showing "Purchase Price". Type new words
    before the heading's last character, and delete old ones afterwards.
    Word's own heading-text cross-reference uses a bookmark of the same
    extent and behaves the same way.
  - Selecting the whole heading text and typing over it deletes the
    bookmark. Every reference to the heading, number or text, then shows
    "Error! Reference source not found." Edit inside the text instead.
- Frontmatter `heading-numbers: legal` numbers the headings. Each `##` is
  `ARTICLE I`, `ARTICLE II`, …, and each `###` is `Section 1.01`,
  `Section 1.02`, …, restarting under each Article. The title (`#`) is not
  numbered. Write only the heading text: `## ARTICLE IV Definitions` fails
  with `DUPLICATE_HEADING_NUMBER`. The numbers come from the Heading 1 and
  Heading 2 styles, so a paragraph set to Heading 2 in Word becomes the next
  Section, and every later number and cross-reference follows when fields
  are updated. Ordered lists under a numbered heading are its clauses:
  `1.` is `(a)`, a nested list `(i)`, then `(A)`. They start again at `(a)`
  under each heading. The first list under a heading starts at `1.`, and a
  later list under the same heading continues the one before it
  (`HEADING_LIST_START` otherwise). An xref to a heading shows its label in
  both forms (`Section 2.04`). An xref to a clause shows `Section 2.04(b)(i)`,
  or `(i)` with `number="paragraph"`. `format="section"` is refused for these
  targets, because their number already includes the word. A `###` needs a
  `##` before it (`HEADING_NUMBER_SKIPS_LEVEL`). Clauses may sit directly
  under an Article only when no Section of it follows
  (`SECTION_AFTER_ARTICLE_CLAUSES`: Word would number that Section N.02).
  An xref to such a clause must use `number="paragraph"`
  (`XREF_FULL_NUMBER_UNDER_ARTICLE`), because Word shows its full number as
  `ARTICLE II(a)` and LibreOffice as `Section 2.01(a)`. Use
  `{% center %}**EXHIBIT A**{% /center %}` for a heading that should not be
  numbered. Without the key, headings are unnumbered and a literal number
  (`## 2.04 Purchase Price`) is plain text.
- A source holding a control character that a Word document cannot hold
  (U+0000–U+001F other than tab, line feed and carriage return) fails with
  `INVALID_CHARACTER` and its line.
- Bare brackets are ordinary text, never highlighted and never an error, even
  when unbalanced: `"[t]he Company"`, `[sic]`, `Section 2[(b)]`. A legend is
  never highlighted, so `{% fill %}` is not allowed inside it.
- Frontmatter `fill-ins: brackets` restores the v0.24 behaviour, where every
  `[…]` is a highlighted fill-in and must balance. In that mode,
  `{% literal %}…{% /literal %}` keeps brackets plain, and raw brackets inside
  a `{% fill %}` still count, so a bracketed blank that crosses the tag ends
  at its own `]`.
- Ordered lists get real `1.` / `(a)` / `(i)` numbering. Each top-level list
  starts at its first marker; nested lists always start at (a) or (i).
- A line ending in `\` is a line break.
- `{% page-break /%}` starts the next block on a new page.
- `{% section %}` starts a next-page section. With no `footer` or
  `page-numbers` attribute, the section keeps the previous section's footer.
  `page-numbers=false` alone gives the section its own empty footer. The
  same holds for the header (below): with no `header` or `header-first`
  attribute, the section keeps the previous section's header.

### Running headers, footers and first pages

The frontmatter sets the first section's header and footer, and the same
keys as `{% section %}` attributes set the next section's:

| Key | Values | Default |
|---|---|---|
| `header` | the header text; on `{% section %}`, `header=false` for an empty header | no header |
| `header-align` | `left`, `center`, `right` | `center` |
| `header-first` | the first page's header text, or `none` | the header |
| `footer` | the footer text | no footer text |
| `footer-align` | `left`, `center`, `right` | `center` |
| `footer-italic` | `true`, `false` (upright) | `true` |
| `footer-layout` | `stacked`, `one-line` | `stacked` |
| `footer-first` | the first page's footer text, or `none` | the footer |
| `page-numbers` | `true`, `false` | `false` |
| `page-number-align` | `left`, `center`, `right` | `center` |
| `page-number-format` | `plain` (`1`), `dashed` (`- 1 -`), `page-of-total` (`Page 1 of 3`) | `plain` |

```markdoc
---
title: Engagement Letter
header: Acme Matter | Engagement Letter
header-align: right
header-first: none
page-numbers: true
page-number-format: page-of-total
---

Dear Client:

**Re: Acme Matter**
```

This letter has no header on page 1 and the right-aligned header from
page 2, with a centred `Page 1 of 2`, `Page 2 of 2` on every page.

- The header is one paragraph in the Header style, aligned on the paragraph
  itself. `page-of-total` writes the total as a `NUMPAGES` field.
- `footer-layout: one-line` puts the footer text at the left margin and the
  page number at the right margin, after a right tab stop, in one paragraph.
  It needs both `footer` and `page-numbers: true` and takes no
  `footer-align` or `page-number-align`.
- `header-first` and `footer-first` are independent. A variant gives the
  section `w:titlePg`. On a first page Word and LibreOffice show only the
  first-page header and footer and never fall back to the others, so both
  are written: the variant where there is one, and a copy of the section's
  header or footer where there is not. `header-first: none` therefore keeps
  the page number on page 1. `footer-first` text replaces the footer text on
  the first page and keeps the page number when the footer has one;
  `footer-first: none` leaves the first page's footer empty. First-page text
  on its own (`header-first: Letterhead` with no `header`) gives an empty
  header on the other pages.
- A section that declares no header or footer inherits the previous one,
  first-page variant included. Without a variant there is no `w:titlePg`.
- A key that shapes text needs that text in the same place: `header-align`
  needs header text (the header's or its first page's); `footer-align` and
  `footer-italic` need footer text; `page-number-align` and
  `page-number-format` need `page-numbers: true`; `header-first: none` and
  `footer-first: none` need a header or footer. Otherwise the build fails
  with `UNSUPPORTED_CREATION_FRONTMATTER` or, on a section, `INVALID_SECTION`
  and its line.
- Verification covers them like the footer. Read-back compares each
  section's header and, under `w:titlePg`, its first-page header and footer
  (`checks.headers`, with negative controls). The round trip compares them
  with the source (controls `deletedHeaderText`, `changedFirstPageHeader`,
  `changedFirstPageFooter`). The PDF word check expects each page's header
  and then its footer at the head of the page, as LibreOffice writes them,
  with the first-page variant on the first page of each section and the
  generated words `Page`, the number, `of` and the total. The PDF must also
  contain the header and footer text each section is sure to show: its own
  without `w:titlePg`, its first-page slots with it (a one-page section never
  shows its other header and footer). These certificate
  entries appear only when the document has a header or a first-page
  variant. A source without the new keys builds the same bytes and
  certificate as before.

### Pulling Word edits back into the source

A created DOCX often goes out for review and comes back edited in Word. `pull`
reads those edits back into the creation `.mdoc`, so the source again
describes the document and the next build keeps them:

```bash
docx-markdoc create letter.mdoc out/                 # out/letter.docx + certificate
# ... the reviewer edits out/letter.docx in Word and saves it ...
docx-markdoc pull out/letter.docx letter.mdoc         # report only; exit 2 when edited
docx-markdoc pull out/letter.docx letter.mdoc --apply # writes letter.pulled.mdoc
mv letter.pulled.mdoc letter.mdoc                     # after reading the diff
docx-markdoc create letter.mdoc out/ --replace        # rebuilds over the edited DOCX
```

```text
pull letter.docx against letter.mdoc: 3 change(s) (3 applied), 0 diagnostic(s)
  line 10: paragraph 3 changed: "fees" -> "charges"; "charge" -> "bill"
  line 12: paragraph 4 deleted: "Fees"
  line 14: paragraph 5 changed: "Company" -> "Client"
wrote letter.pulled.mdoc
wrote out/letter.pull.json: create --replace accepts the edited letter.docx when it builds exactly this pulled source into that output directory
```

How it works:

- `pull` reads `<stem>.verification.json` beside the edited DOCX
  (`--certificate` names another). The `.mdoc` must be the source that
  certificate records (`PULL_SOURCE_CHANGED` otherwise). `pull` rebuilds
  that build from it (`PULL_BASE_MISMATCH` when it cannot be reproduced; pass
  the build's `--style-profile`), so the comparison is with the exact DOCX
  that went out.
- Body paragraphs are paired with the edited ones and diffed word by word.
  Each change is reported with its source line: a changed paragraph with its
  word edits, a deleted paragraph with its lines, added paragraphs after a
  line, and each section's changed header or footer at the frontmatter
  (line 1) or its `{% section %}` tag. The pairing is a heuristic: where
  several paragraphs changed at once it can report two edits where a reader
  sees a deletion and an insertion; either reading rebuilds the same text.
- With `--apply` the changes it can express go into a new file,
  `<stem>.pulled.mdoc` beside the source or `--output new.mdoc`; an existing
  file is never overwritten and the inputs are only read. Markup around
  unchanged text stays as written. Edits inside a fill-in, bold, italic or
  underlined text, or a signer's name or date, are made in place. A deletion
  across a markup boundary deletes from each side, and new text whose
  formatting changes at the boundary goes to each side; deleting or typing
  over a whole fill-in, span or cross-reference (with its field) removes its
  markup; markup around text the edit keeps always stays. Deleting the first
  item of a numbered list gives its number to the next item. New text is escaped so Markdown reads it as text. Added
  paragraphs take their markup from their Word style (`#`, `##`, `###`,
  `>`, `{% center %}`, `{% legend %}`, list items, body text) and their bold,
  italic and underline. A one-line header or footer text and page numbers
  map to the [running-text keys](#running-headers-footers-and-first-pages).
- Every change is applied on its own and kept only when the source still
  builds and reads back as expected; then the whole pulled source must pass
  every `create` check and reproduce the edited body text, character
  formatting, headers and footers, list numbers and table structure.
- What Word for Mac changes when it merely saves a create output is not an
  edit: the outline level it states on the built-in heading styles, a left
  alignment it drops as redundant, and the cell margins it adds to a table.
  An unedited DOCX opened and saved in Word pulls as `no changes`.
- Tracked changes are refused (`PULL_TRACKED_CHANGES`) wherever they are,
  headers, footers and notes included: accept or reject them in Word first,
  so the source records what the reviewer decided.

What `pull` cannot express it reports as a `DIAGNOSTIC <code>` line and
leaves out; the paragraph it touches stays as it was, and nothing is
dropped without a line:

| Code | Edit |
|---|---|
| `PULL_EDIT_CROSSES_MARKUP` | changes markup it cannot keep: half a fill-in's brackets, an emptied span, a footnote mark or a line break |
| `PULL_EDIT_IN_CROSS_REFERENCE`, `PULL_EDIT_IN_GENERATED_TEXT` | edits the text of a cross-reference, retargets, moves or re-switches it, or edits text the markup generates (`Section `, a signature line) |
| `PULL_DIRECT_FORMATTING`, `PULL_PARAGRAPH_FORMATTING`, `PULL_STYLE_CHANGED` | formatting create does not express: a word made bold, a paragraph re-aligned or indented, a changed style, a cross-reference's cached result reformatted or given a tab or line break |
| `PULL_ADDED_PARAGRAPH_STYLE` | an added paragraph in a style with no creation markup |
| `PULL_PAGE_SETUP`, `PULL_SECTION_STRUCTURE` | changed page size, margins or sections |
| `PULL_DOCUMENT_SETTINGS`, `PULL_DOCUMENT_PROPERTIES` | a layout setting (default tab stop, hyphenation, mirrored margins, book folds) or the title, author, subject, description or keywords |
| `PULL_NUMBERING_CHANGED`, `PULL_TABLE_STRUCTURE` | list numbering (a start value, a restart, a format, the label's look) or table structure and layout (merged cells, column widths, borders, captions) |
| `PULL_HEADER_UNMAPPED`, `PULL_FOOTER_UNMAPPED` | running text the keys cannot express: several lines, fields (or a page number given a switch such as `\* roman`), formatting, even-page headers and footers |
| `PULL_COMMENTS`, `PULL_FOOTNOTES_CHANGED`, `PULL_FIELD_CHANGED`, `PULL_BOOKMARKS_CHANGED`, `PULL_UNSUPPORTED_CONTENT` | comments, footnote edits or moved footnote marks, new or changed fields, bookmarks (anchors) added, removed or moved, images, hyperlinks, content controls |
| `PULL_UNEXPRESSIBLE_TEXT` | text creation Markdoc cannot write, such as a tab |
| `PULL_PARAGRAPH_NOT_MAPPED`, `PULL_UNMAPPED_DELETION`, `PULL_UNMAPPED_INSERTION` | a paragraph, deletion or insertion pull could not place in the source |
| `PULL_EDIT_NOT_VERIFIED`, `PULL_REBUILD_DIFFERS` | a planned change that did not read back as the edited DOCX |

`pull` compares the body, headers, footers, footnotes, every style the build
defines, numbering, tables, sections and page setup, the layout settings and
the document properties above. It does not compare the theme, the font
table, web and compatibility settings, custom XML parts, or table cell
margins (which Word adds when it saves a table); an edit made only there is
not reported.

Exit codes: `0` when the edited DOCX reads as the build, `2` when changes or
diagnostics are reported (with `--apply`, after writing), `1` on an error.
`--json` prints the report as JSON.

**`create --replace` after a pull.** A pull is complete when every change
was written and no diagnostic was raised. Then `--apply` also writes
`<stem>.pull.json` beside the certificate, binding the edited DOCX's
SHA-256, the certified build and the pulled source's SHA-256. `create
--replace` accepts that one edited DOCX in place of the certified one when
it builds exactly the pulled source (copied over the original, as above). It
keeps the edited bytes in `.<stem>.create-overwritten-<uuid>/`, says so in
its output, and removes the record. Any other source, another edit to the
DOCX, or an incomplete pull still fails with `CREATION_OUTPUT_EDITED`. After
an incomplete pull, read the diagnostics, make those edits in the source by
hand, and rebuild with `--dangerously-overwrite-edited-docx`, which also
keeps the edited bytes.

### Migrating from a per-matter python-docx renderer

Projects that build new instruments (consents, resolutions, certificates)
with a copied python-docx script can replace it with one command per
document:

```bash
npx -y @usejunior/docx-markdoc create authoring/<slug>.mdoc outbound/draft --replace
```

The command writes these files into `outbound/draft/`:

- `<slug>.docx`;
- `<slug>.txt`, read back from the `.docx` and written beside it (not in a
  `text/` subfolder);
- `<slug>.verification.json`;
- `<slug>.pdf`, but only when LibreOffice (`soffice`) and `pdftotext` are
  installed.

Without those tools, no PDF is written, the certificate records the PDF check
as `not_run`, and the build still succeeds. Add `--require-pdf` to make
missing tools a failure, or `--no-pdf` to skip the check. Nothing is
published unless every check that ran passes; a mismatch leaves
`<slug>.failed-verification.json` instead.

Convert each `.mdoc` once, using the table below. Clause numbers typed by
hand become Markdown ordered lists, whose real `1.` / `(a)` / `(i)`
numbering survives later redlines. Fill-ins become `{% fill %}…{% /fill %}`,
because bare `[…]` is now literal text. To keep a renderer's old
brackets-are-blanks reading while you convert, add `fill-ins: brackets` to the
frontmatter. Leftover pseudo-HTML
fails with `LEGACY_MARKUP`, and the error names the tag to use instead.
Make later edits through `docx-markdoc import` / `compile`, which produce
tracked changes. Once someone edits the `.docx` itself, `--replace` refuses
to rebuild over it (`CREATION_OUTPUT_EDITED`), so a rebuild cannot silently
discard those edits; `docx-markdoc pull` brings them back into the `.mdoc`.

### Moving from per-matter pseudo-HTML `.mdoc`

| Old convention | Markdoc |
|---|---|
| `<center>text</center>` | `{% center %}text{% /center %}` |
| `<legend>text</legend>` | `{% legend %}text{% /legend %}` |
| `<signer>Name, Title \| Date: ___</signer>` | `{% signer name="Name, Title" date="Date: ___" /%}` |
| `<!-- pagebreak -->` | `{% page-break /%}` |
| `<!-- page-numbers -->` | frontmatter `page-numbers: true` |
| `<!-- section: x footer="…" -->` | `{% section footer="…" /%}` |
| header or page number added with python-docx after the build | frontmatter `header:`, `header-first:`, `page-number-format:` (see Running headers) |
| `## 1. Heading` with a literal number, `(a) text` | `## Heading` plus an ordered list (real numbering) |
| `<u>Purchase Price</u>` | `{% u %}Purchase Price{% /u %}` |
| `[Effective Date]` as a highlighted blank | `{% fill %}Effective Date{% /fill %}` (or frontmatter `fill-ins: brackets`) |
| `document_id:` frontmatter | `title:` / `author:` / `date:` |

Leftover pseudo-HTML fails with `LEGACY_MARKUP`, and the error names the tag
to use instead.

The `create` command sits on the generic engine above: a closed-grammar
validator, a house theme, tag plugins and a section driver. The
template-backed `compile-greenfield` command is unchanged.

## Plain PDF render for finished documents

`renderPlainPdf` renders a finished, non-tracked DOCX with LibreOffice in a
disposable profile, then checks the `pdftotext -raw` text layer
(content-stream order, which for LibreOffice output is document order page by
page; a table row split across pages comes out cell fragment by cell
fragment). It also extracts the `pdftotext -layout` text of each page
(`layoutPageTexts`), which keeps word boundaries that the raw text can lose
when LibreOffice exports a justified line without space glyphs. Each
`requiredText` entry must appear within a single rendered page (anywhere on
it, headers and footers included, in either its raw or its layout text),
compared with whitespace collapsed and no other normalization. An empty PDF or an empty text layer fails. Missing
tools report `not_run`, never a pass. The input DOCX is copied, never
modified; an `outputPdfPath` that aliases it is refused. The PDF reaches
`outputPdfPath` only when every check passes, through a staged file renamed
over the destination, so a symlink or hard link that appears at the
destination mid-render is replaced, never written through. `pageCount` counts
form-feed-delimited pages, blank pages included. It needs LibreOffice
(`soffice`, or the path in `SAFE_DOCX_SOFFICE_BIN`) and `pdftotext` on the
machine, and no npm package beyond this one.

```ts
const verdict = await renderPlainPdf({
  docxPath: 'consent.docx',
  outputPdfPath: 'consent.pdf',
  requiredText: ['ACME WIDGETS INC.', '[Signature Page to Consent]'],
});
// verdict.status: 'passed' | 'failed' | 'not_run'; verdict.pageTexts: each page's text, when extraction ran
```

Annotation replies may be declared before their parents. Projection schedules
parents first and rejects cyclic reply graphs. A reply projected as a comment
requires its parent to be projected as a comment too.

Both edit-pair export functions reject source-only IR whose omitted before text
has not yet been resolved against the pinned source. Compile it first and export
from the resulting IR.
