# Design: Story-scoped Markdoc authoring

## Context

Headers and footers are separate WordprocessingML parts selected by direct
`w:headerReference` and `w:footerReference` relationships on section
properties. One physical part may be selected by several sections, and
`headerN.xml`/`footerN.xml` filenames are allocation details rather than
semantic identity. Canonical Markdoc currently imports only body paragraphs;
the comparison pipeline preserves ordinary selected-story changes but reports
them as unrepresented.

The existing comparison implementation already resolves selected ancillary
stories by semantic section binding and scaffold identity for text-box work.
This change extends that inventory to ordinary paragraph content instead of
creating a second resolver.

## Goals / Non-Goals

### Goals

- Edit text in existing selected header/footer paragraphs, including paragraphs
  in existing table cells, with clean before/after authoring.
- Insert or delete paragraphs only where the existing body/table-cell safety
  rules have a direct side-story analogue.
- Emit native `w:ins`/`w:del` markup in the owning header/footer part.
- Prove package-level accept/reject fidelity and disclose all aliases of a
  shared physical story.

### Non-Goals

- Create, delete, copy, or rebind header/footer parts or section selectors.
- Change first/default/even inheritance, `titlePg`, or section topology.
- Structurally edit header/footer tables, drawings, fields, content controls,
  or text boxes; edit nested text-box content through this Markdoc syntax.
- Materialize rationale or annotation comments whose operative anchor is in a
  header/footer story.
- Expose physical package filenames as canonical authoring identity.

## Decisions

### 1. Import physical stories once and expose semantic bindings

Import resolves direct section selectors through the package relationship
graph. Each distinct selected physical part becomes one self-closing canonical
story declaration:

```markdoc
{% story
   id="story-header-a1b2c3"
   kind="header"
   bindings="0:first,1:default"
   fingerprint="sha256:..."
   paragraphs=2
/%}
```

The opaque ID is deterministically derived from the pinned source inventory,
not from a raw `headerN.xml` filename. `bindings` is the complete sorted set of
zero-based section ordinal plus `first|default|even` selector pairs. A shared
part is never projected twice.

### 2. Keep declarations and operations top-level

Canonical source paragraphs and operations remain top-level tags. Side-story
paragraphs and operations carry `story="<id>"`; omitted `story` continues to
mean the main body. This preserves the existing parser and keeps diffs readable:

```markdoc
{% source-paragraph story="story-header-a1b2c3" id="_bk_..." fingerprint="sha256:nfkc:..." style="Header" %}
(17 September 2026 Draft)
{% /source-paragraph %}

{% change story="story-header-a1b2c3" id="_bk_..." fingerprint="sha256:nfkc:..." style="Header" operation="update-date" format="inherit-source-paragraph" %}
{% before %}(17 September 2026 Draft){% /before %}
{% after %}(18 September 2026 Draft){% /after %}
{% /change %}
```

Import inserts globally unique Safe DOCX bookmark anchors into admitted
side-story paragraphs in the separate anchored source copy. Story identity is
still mandatory: an anchor is resolved only inside its declared story, and a
body/side mismatch fails before mutation.

### 3. Admit text operations without admitting story topology changes

Replacement reuses the existing localized formatting rules. Paragraph
insertion/deletion reuses body rules plus the existing physical-cell trailing-
paragraph invariant when the anchor is inside a header/footer table. The first
slice rejects vertical-merge continuations, nested tables, text boxes, and any
operation that changes table, section, relationship, drawing, field, or content-
control topology.

A shared story edit intentionally affects every selector listed in its binding
closure. The certificate reports that closure; there is no syntax for editing
only one alias without first authoring a distinct Word story outside Markdoc.

### 4. Compare selected stories independently with the shared engine

For original and clean packages whose selected-story topology is unchanged,
the comparison pipeline pairs each story through the existing semantic
inventory. It compares admitted paragraph sequences with the same tagged-tree
atomization, common-token retention, revision construction, field validation,
and accept/reject logic as the main body, then splices the compared children
back into the preserved revised story root.

The story root, relationships, tables, drawings, fields, content controls, and
other non-paragraph scaffold must remain semantically equal outside the
admitted text operations. A changed scaffold produces a typed unsupported-
story diagnostic rather than an opaque replacement.

### 5. Extend certification from body text to package stories

The current Markdoc certificate's text checks are body-only. Side-story success
requires a story projection report containing, per edited story:

- source/clean story identity and complete bindings;
- reject-all text and formatting equality to source;
- accept-all text and formatting equality to clean;
- unchanged scaffold and relationship closure;
- zero unresolved story revisions; and
- absence of a corresponding `unrepresentedChanges` entry.

The aggregate projection verdict fails when any edited story report fails.
Unedited selected side parts remain covered by unchanged-package preservation.

### 6. Keep rationale metadata but reject side-story comment rendering

Internal rationale can remain adjacent metadata for a side-story operation.
Native Word comment anchoring in headers/footers has a separate compatibility
surface, so external-facing rationale or annotation materialization targeting a
side-story operation fails before mutation in this slice. It is not silently
moved to body text or dropped.

## Risks / Trade-offs

- **Shared-story surprise.** One edit may affect multiple sections. Import and
  certificates expose the complete binding closure, and partial-alias edits are
  rejected.
- **Story pairing ambiguity.** Repeated identical scaffolds can be ambiguous.
  The source hash, opaque story ID, fingerprint, and complete binding inventory
  all must agree; the compiler never guesses by ordinal or filename alone.
- **Field-bearing running text.** PAGE-family and other fields can fragment
  visible text. Existing field-aware comparison and validation remain
  authoritative; unsupported edit boundaries fail closed.
- **Comparison overlap.** Selected-story discovery already exists for nested
  text boxes. This change extends that code path and its tests instead of
  independently walking section relationships in Markdoc and comparison.

## Migration Plan

Body-only Markdoc remains byte-for-byte syntax compatible. New story tags are
emitted only when an imported source has admitted selected header/footer parts.
The feature is additive and experimental; no stored canonical document requires
migration.

