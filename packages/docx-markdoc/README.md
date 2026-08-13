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

## Delivery completeness

Exact DOCX replay and drafting completeness are separate claims. A required
drafting decision names the operation or operations that satisfy it:

```markdoc
{% requirement id="remove-obsolete-block" satisfied-by="remove-heading,remove-body" mode="all" %}
Remove the obsolete block without leaving a heading or signature remnant.
{% /requirement %}

{% change-set id="remove-obsolete-block" operations="remove-heading,remove-body" atomic=true /%}
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
{% change id="_bk_..." fingerprint="..." style="Normal" operation="rewrite" format="inherit-source-paragraph" %}
{% before %}The original paragraph.{% /before %}
{% after %}The complete revised paragraph.{% /after %}
{% /change %}
```

Text replacement and deletion of an existing numbered paragraph preserve its
source `w:pPr`, including paragraph style, `w:numPr`, level, indentation, and
list identity. Inserting a numbered item requires an explicit existing
paragraph as the formatting source so the compiler never guesses between an
adjacent list level and a list terminator:

```markdoc
{% insert-after anchor="_bk_current_item" operation="add-item" style-source="_bk_current_item" %}
{% after %}The new numbered item.{% /after %}
{% /insert-after %}
```

This supports editing text within existing list topology; changing numbering
definitions, restarting a list, or changing list levels remains out of scope.

Mixed-format paragraphs are edited surgically: unchanged spans retain their
source runs, and a replacement inherits the one formatting class occupied by
the deleted source span. If an insertion lands exactly between incompatible
formats, or a replacement crosses formats, compilation fails closed. The
author may resolve that ambiguity by naming one unique source substring:

```markdoc
{% change id="_bk_..." fingerprint="..." style="Normal" operation="rewrite" format="inherit-source-paragraph" format-source="Defined Term" %}
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
{% change id="_bk_..." fingerprint="..." style="Normal" operation="replace-fill" format="inherit-source-paragraph" underline="single" highlight="yellow" %}
{% before %}2026-08-12{% /before %}
{% after %}________________{% /after %}
{% /change %}
```

Only the generated replacement receives those direct properties. All
undeclared properties remain inherited from the selected source run. A
run-format declaration is rejected before mutation if its operation produces
zero or multiple generated text hunks; split the work into separate
source-anchored operations instead. An inserted paragraph is one zero-width
source hunk and may use the same overlay.

The canonical Markdoc is compact. `inspectMarkdocSource` generates normalized
formatting detail for selected paragraphs when an edit needs it. With no IDs it
returns the full document; with `paragraphIds` it returns only those anchors.
Adjacent physical Word runs with identical direct run properties are coalesced,
while `start`, `end`, `paragraphPropertySha256`, `runPropertySha256`, and
`sourceRunCount` keep
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
