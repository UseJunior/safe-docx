# `@usejunior/docx-markdoc`

Brownfield DOCX authoring as readable clean document states over a hash-pinned
Word source. The redline is deterministic derived output, not canonical input.

```markdoc
{% source sha256="..." paragraphs=2 /%}

{% change id="_bk_..." fingerprint="sha256:nfkc:..." style="Normal" operation="rename" format="inherit-source-paragraph" %}
{% before %}
The Old Name.
{% /before %}
{% after %}
The New Name.
{% /after %}
{% /change %}

{% rationale for="rename" %}
Use the entity's current legal name.
{% /rationale %}
```

Compilation verifies the clean before state against the pinned source, applies
the clean after state, and derives native tracked changes with Safe DOCX's
comparison engine. It then proves reject-all equals source and accept-all equals
clean. Inline `ins`/`del` is available only as generated display/export syntax;
models and lawyers author familiar complete sentences.

Whole-paragraph changes keep both clean states explicit:

```markdoc
{% change id="_bk_..." fingerprint="..." style="Normal" operation="rewrite" format="inherit-source-paragraph" %}
{% before %}The original paragraph.{% /before %}
{% after %}The complete revised paragraph.{% /after %}
{% /change %}
```

The canonical Markdoc is compact. `inspectMarkdocSource` generates normalized
formatting detail for selected paragraphs when an edit needs it. With no IDs it
returns the full document; with `paragraphIds` it returns only those anchors.
Adjacent physical Word runs with identical direct run properties are coalesced,
while `paragraphPropertySha256`, `runPropertySha256`, and `sourceRunCount` keep
the readable view tied to the source formatting without copying raw OOXML into
canonical Markdoc. Inspection output is diagnostic and cannot be compiled.

Leading or trailing spaces in operative text must be written as `&#32;` because
Markdown treats ordinary boundary spaces as syntax. The importer does this
automatically, including escaping literal `&` first, so import and replay remain
exact. Ordinary interior spaces stay ordinary and readable.

`exportAdjacentRevisionPairs` compares two canonical states over the same
hash-pinned source. It copies caller-supplied labels verbatim and never infers an
actor, cause, authorization, privilege status, de-identification status, or
training eligibility; those remain downstream responsibilities.
