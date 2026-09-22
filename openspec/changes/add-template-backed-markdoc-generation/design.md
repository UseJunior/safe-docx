# Design: Template-backed greenfield Markdoc generation

## Context

The existing compiler treats a DOCX as substantive source: canonical Markdoc
declares its before and after states, and comparison derives a redline. A
greenfield form has no substantive before state. Its DOCX input is only a
trusted presentation scaffold whose package parts and final section properties
must survive while canonical Markdoc supplies every body paragraph.

`@usejunior/docx-core` also has a from-scratch `DocumentSpec` generator, but it
emits a new styles/theme/numbering package. It therefore cannot preserve an
arbitrary existing house style. Greenfield Markdoc needs a bounded template
projection path rather than a second general-purpose generator.

## Goals / Non-Goals

### Goals

- Keep the `.mdoc` body tag-free and authoritative for all new body text.
- Preserve an existing one-section template's style and package graph.
- Make style selection explicit, validated, deterministic, and hash-bound.
- Prove which package part changed and bind every input/output artifact.
- Reject ambiguous templates instead of silently flattening them.

### Non-Goals

- Derive a redline against placeholder template body text.
- Infer house-style roles from visual properties or style names.
- Import template body tables, fields, drawings, content controls, or notes.
- Support multiple sections, lists, tables, inline Markdown, or arbitrary raw
  OOXML in the first greenfield grammar.
- Create a missing header/footer relationship or physical story. Any desired
  running story must already exist in the template; the shipped side-story
  authoring surface can edit paragraphs in an existing selected story.

## CLI and library contract

The CLI adds:

```text
docx-markdoc compile-greenfield <template.docx> <document.mdoc> <output-dir>
  [--style-profile profile.json]
```

The output directory is new and receives `clean.docx` and
`verification.json`. Greenfield compilation does not emit `redline.docx`: a
presentation template is not a legal-text reject state, and pretending that
its placeholder body is a substantive source would produce misleading review
evidence.

The library exports `compileGreenfieldMarkdoc(template, markdoc, options?)`.
The optional style profile is plain JSON data:

```ts
type GreenfieldStyleProfile = {
  bodyStyleId: string;
  headingStyleIds?: Partial<Record<1 | 2 | 3 | 4 | 5 | 6, string>>;
};
```

With no profile, body paragraphs use `Normal` and headings use the standard
`Heading1` through `Heading6` IDs. The compiler validates every style actually
used against `word/styles.xml`; it never guesses a replacement style. The
certificate records the resolved mapping and, when a profile file is supplied,
its SHA-256.

## Canonical body grammar

The `.mdoc` input contains only:

- ATX headings (`#` through `######`, one required space); and
- plain paragraph blocks separated by one or more blank lines.

The compiler parses the body with the repository's Markdoc/CommonMark parser.
Only plain-text inline nodes and soft breaks are admitted. Consecutive
nonblank lines in a paragraph join with one U+0020, following the ordinary
Markdown soft-break reading. Leading/trailing block whitespace is removed,
while internal repeated spaces remain exact. Runs of `_` or `*` that the
parser leaves as literal text (including `_____` form blanks) remain literal;
`&`, `<`, and `>` in plain text are accepted and XML-escaped; CommonMark
backslash escapes resolve to their literal character. A `#` without a
following space remains ordinary paragraph text. Any parsed emphasis, strong,
code, link, image, HTML, or other non-text inline node fails with its source
position. An empty document, Markdoc tags, indented/fenced code, thematic
breaks, block quotes, lists, and tables likewise fail. A heading level without
a resolved mapping also fails. This keeps the first version reviewable and
prevents syntax from disappearing silently during Word emission.

Every emitted paragraph contains an explicit `w:pStyle` and plain `w:t` run.
The implementation SHALL add or expose one small shared plain-text run emitter
that XML-escapes content and applies `xml:space="preserve"` when required,
rather than citing an unexported editing helper. Canonical text, not template
placeholder content, supplies every emitted `w:t` in the body.

## Template admission and projection

The admitted template is a valid DOCX with:

- one `word/document.xml` body;
- exactly one final direct body-level `w:sectPr`;
- no earlier paragraph-level or body-level section break;
- no existing tracked revisions in any relationship-selected revision story;
  the audit uses `enumerateSelectedRevisionStoryPartPaths` and rejects every
  element in `TRACKED_CHANGE_ELEMENT_NAME_SET`, including property and
  `sectPrChange` wrappers; and
- resolvable selected header/footer relationships and referenced package parts.

The template body may contain placeholder blocks, but none survive. The
compiler clones the package, removes every direct body child except the final
`w:sectPr`, emits canonical paragraphs before it, and updates only
`word/document.xml`. The final `w:sectPr`, its relationship IDs, and all
referenced header/footer parts remain byte-for-byte equal as XML part content.
Direct body bookmarks, content controls, drawings, tables, and placeholder
paragraphs are deliberately dropped with the rest of the template body.

This bounded path deliberately leaves unused document relationships and media
in place. Removing them would broaden the changed-part set and risk deleting a
resource still used by a preserved header/footer, style, numbering, or custom
part. A later package-compaction feature may prune proven-unreachable parts.

The same preservation rule retains `docProps/core.xml`, `docProps/app.xml`,
`word/settings.xml`, and `customXml/*` verbatim. Template modified dates and
page/word statistics can therefore be stale in v1. The certificate exposes
their unchanged hashes rather than implying that they describe the new body.
Deterministically refreshing document properties is a later, separately
specified changed-part expansion.

## Certificate and verification

The versioned greenfield certificate records:

- canonical Markdoc SHA-256 and normalized body-block inventory;
- template DOCX SHA-256;
- optional style-profile SHA-256 and resolved style mapping;
- output DOCX SHA-256;
- template and output `word/document.xml` SHA-256 values;
- the exact changed-part allowlist (`word/document.xml` only);
- content hashes for every unchanged OPC part; and
- section/header/footer relationship inventories before and after.

Compilation reloads the produced DOCX and proves:

- emitted body blocks and style IDs equal the parsed canonical body;
- the final section properties are canonically equal to the template;
- selected header/footer bindings and target part bytes are unchanged;
- every package part outside `word/document.xml` has identical uncompressed
  bytes; and
- the clean output contains no tracked revision markup.

The clean-output revision check enumerates the same relationship-selected
revision story parts and element set used at admission, not filename guesses.

Any mismatch makes the certificate fail and prevents CLI output. Hashes are
over exact input/output bytes; semantic inventories are additional evidence,
not substitutes for the cryptographic bindings.

## Determinism and output safety

Identical template, Markdoc, and style-profile bytes produce byte-identical
DOCX and certificate content. The implementation SHALL extend the archive
replacement/save path so `word/document.xml` is written with the fixed
generation epoch (`2006-01-01T00:00:00Z`) rather than JSZip's current-time
default; all untouched entries retain their template metadata. The compiler
never reads the clock or randomness. Output reservation reuses
`writeNewFiles` for exclusive creation and cleanup and adds explicit preflight
that every output path differs from every input path; existing files,
symlinks, and input/output collisions fail before writing.

## Risks / Trade-offs

- **Single-section v1 is narrow.** This is intentional: retaining intermediate
  section-break paragraphs while claiming that canonical Markdoc is the only
  body source would be contradictory. Multi-section generation needs explicit
  canonical section syntax.
- **Unused relationships remain.** Preserving them is safer than pruning them
  without a package-wide reachability proof; the certificate makes the choice
  visible.
- **Template document properties remain stale.** Preserving every non-document
  part keeps the trust boundary narrow but means page/word counts and modified
  dates may describe the template; the certificate discloses this.
- **Plain text only limits forms.** It eliminates ambiguous Markdown loss. New
  block/inline constructs can be added as independently specified syntax.
- **Style IDs are template-specific.** Explicit validation makes that coupling
  reviewable and prevents visual heuristics from silently changing output.
- **A missing running story is not created.** The phase-one fixture must use a
  template whose desired header/footer already exists. The negative control
  proves the custom clone/clear/style/footer-preservation compiler is no longer
  required; it does not claim structural header creation.

## Implementation sequencing

The proposal lands and is peer-reviewed before implementation. The
implementation PR then adds parsing/types, template admission/projection,
certificate verification, CLI/output integration, real-template tests, and
documentation in that order.
