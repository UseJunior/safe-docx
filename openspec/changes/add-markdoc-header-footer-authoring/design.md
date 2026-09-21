# Design: Story-scoped Markdoc authoring

## Context

Headers and footers are separate WordprocessingML parts selected by direct
`w:headerReference` and `w:footerReference` relationships on section
properties. One physical part may be selected by several sections, and
`headerN.xml`/`footerN.xml` filenames are allocation details rather than
semantic identity. Canonical Markdoc, the paragraph mutation facade, and
accept/reject projection currently operate on the body (plus a different fixed
set of revision side parts); they do not yet author or project selected
headers/footers. The comparison pipeline preserves ordinary selected-story
changes but reports them as unrepresented.

The conformance basis is ECMA-376 edition 5, Part 1 §§ 17.10.2 and 17.10.5
for `w:ftr`/`w:hdr`, §§ 17.10.3 and 17.10.4 for their section references, and
§ 17.13.6.2 for bookmark starts.

The existing comparison implementation already inventories selected ancillary
stories and their section bindings for text-box work. Its current pairing keys
include ordinary content, so this change extends the inventory with exact
binding-closure pairing and an ordinary-text-blanked scaffold rather than
creating a second relationship walker.

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

The opaque ID is a deterministic hash of the story kind and complete semantic
binding closure, not of content or a raw `headerN.xml` filename. Content is
pinned separately by `fingerprint`. `bindings` is the complete sorted set of
zero-based section ordinal plus `first|default|even` selector pairs. A shared
part is never projected twice.

### 2. Keep declarations and operations top-level

Canonical source paragraphs and operations remain top-level tags. Side-story
paragraphs and operations carry `story="<id>"`; omitted `story` continues to
mean the main body. This preserves the existing parser and keeps diffs readable:

```markdoc
{% para story="story-header-a1b2c3" id="_bk_..." fingerprint="sha256:nfkc:..." style="Header" %}
(17 September 2026 Draft)
{% /para %}

{% change story="story-header-a1b2c3" id="_bk_..." fingerprint="sha256:nfkc:..." style="Header" operation="update-date" format="inherit-source-paragraph" %}
{% before %}(17 September 2026 Draft){% /before %}
{% after %}(18 September 2026 Draft){% /after %}
{% /change %}
```

The top-level `source.paragraphs` count remains body-only; each story declaration
owns its paragraph count, ordered scaffold, and drift checks. Import allocates
Safe DOCX bookmark names and numeric IDs from one package-wide reservation set,
then inserts them into admitted side-story paragraphs in the separate anchored
source copy. Story identity is still mandatory: an anchor is resolved only
inside its declared story, and a body/side mismatch fails before mutation.

This package-wide allocation follows ECMA-376 edition 5, Part 1 § 17.13.6.2
and avoids body/header collisions even when text and neighbors are identical.

### 3. Admit text operations without admitting story topology changes

The primitive layer first gains story-scoped equivalents of paragraph bookmark
insertion, lookup, replacement, insertion, deletion, and table-cell validation,
all addressed by selected part plus anchor. Existing localized formatting rules
are re-hosted on that story root. Cell topology, cross-cell style sources,
vertical-merge continuations, and the required final direct `w:p` block
(ignoring range markers) are evaluated against the physical cell in the story
DOM, never the body view.

An admitted paragraph is a direct `w:p` child of the story root or of a `w:tc`.
Its content may comprise `w:pPr`; range/proof markers; `w:hyperlink`; and `w:r`
content limited to `w:rPr`, `w:t`, `w:tab`, `w:br`, `w:cr`, `w:sym`,
`w:noBreakHyphen`, and `w:softHyphen`. Existing `w:fldSimple` and complex-field
sequences may be present only when the edit range does not intersect them; they
are preserved verbatim. A paragraph containing `w:drawing`, `w:pict`,
`mc:AlternateContent`, `w:sdt`, `w:txbxContent`, `w:object`, comment references,
or note references is projected read-only and receives no operative anchor.

The first slice rejects nested tables, text boxes, field-intersecting edits, and
any operation that changes table, section, relationship, drawing, field,
content-control, or other unsupported topology.

A shared story edit intentionally affects every selector listed in its binding
closure. The certificate reports that closure; there is no syntax for editing
only one alias without first authoring a distinct Word story outside Markdoc.

### 4. Compare selected stories independently with the shared engine

For original and clean packages with equal section counts and selector sets,
the comparison pipeline pairs each physical story by its complete sorted
binding closure: the identical set of `(sectionOrdinal, kind, role)` selectors
must resolve to one physical part on each side. Binding closures are disjoint;
a closure present on only one side, a changed section count, or ambiguous
ownership fails closed and remains unrepresented. Existing canonical-content
and text-box scaffold buckets are not pairing keys for ordinary-text stories.

After pairing, the engine checks a scaffold fingerprint that blanks ordinary
paragraph run text as well as nested `w:txbxContent`, so admitted text can
change while structural content cannot. It compares admitted paragraph
sequences with the same tagged-tree
atomization, common-token retention, revision construction, field validation,
and accept/reject logic as the main body, then splices the compared children
back into the preserved revised story root.

Field-state validation is extended by relationship-walking every selected
header/footer part; the existing body-only `splitStories` exclusion is removed.

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
An edited story has no matching `unrepresentedChanges` slot for any selector in
its full binding closure. `unchangedPartsEqual` excludes edited story parts,
which are covered by their semantic reports; all other package parts remain
byte-compared. Unedited selected side parts remain covered by unchanged-package
preservation.

Package accept/reject is extended to every relationship-selected header/footer
part rather than filename patterns. Its per-part counters aggregate with the
existing body/side-story results, and no unresolved revision may remain in an
edited story.

### 6. Keep rationale metadata but reject side-story comment rendering

Internal rationale can remain adjacent metadata for a side-story operation.
`exportEditPairs` includes these operations with their story identity.
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
- **Public primitive expansion.** Story-scoped mutation and package projection
  are prerequisites, not assumed behavior; their delta and tests land in the
  same implementation PR before Markdoc uses them.

## Migration Plan

Body-only Markdoc remains byte-for-byte syntax compatible. New story tags are
emitted only when an imported source has admitted selected header/footer parts.
The feature is additive and experimental; no stored canonical document requires
migration.
