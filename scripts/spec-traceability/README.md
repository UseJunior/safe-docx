# spec-traceability (PoC)

First-cut, local-only proof of concept for linking OOXML XSD elements to
their conformance documentation. Built against issue #227.

This is not part of CI and never will be. The script is invoked by hand on
a developer machine; its output lives under `out/` (gitignored). Treat
the code as exploratory — if the PoC graduates, the follow-up work is
tracked in issue #227 and will land via an OpenSpec change.

## Canonical source: [MS-OE376], not raw ECMA-376

The script reads Microsoft's **[MS-OE376] — Office Implementation
Information for ECMA-376 Standards Support** (a `.docx` file the user
keeps at `~/Downloads/[MS-OE376]-220816.docx`; latest version at
<https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oe376/db9b9b72-b10b-4e7e-844c-09f88c972219>).

Why MS-OE376 over the ECMA-376 PDF:

- Microsoft Word's implementation is what safe-docx must round-trip in
  the real world; "but the standard allows it" is no defense if Word
  refuses to open a file. MS-OE376 documents the deltas.
- It's structured DOCX — `Heading3` paragraphs follow a strict pattern
  (`Part <N> Section <X.Y.Z[.W]>, <elementName> (<Description>)`) so
  anchoring is deterministic, not heuristic.
- Per-element notes are paired `Definition-Field` / `Definition-Field2`
  paragraphs: the first says what the standard does, the second says
  what Word does. Many element sections cross-reference a shared notes
  cluster (e.g., 78+ sections point at the `oMath §7.1.2.77` block); the
  PoC resolves these cross-references inline.
- safe-docx parses DOCX for a living. Dogfooding feels right.

### Part-numbering wrinkle

[MS-OE376] uses **2nd-edition ECMA-376 Part numbering**:
WordprocessingML lives in **Part 4 §2.3.1.x**, not Part 1 §17.3.1.x.
The vendored XSDs under `spec-compliance/ecma-376/schemas/` are
5th-edition (Part 1 §17). The mapping for `<w:p>` is:

| Edition | Part | Section |
|---|---|---|
| 2nd / [MS-OE376] | 4 | §2.3.1.22 |
| 5th / vendored XSD | 1 | §17.3.1.22 |

The emitted HTML uses a `MSOE376-PART4-…` stable-ID grammar to keep this
distinct from the registry's existing `ECMA-PART1-…` IDs.

## What this does

For one XSD element (default `w:p`), the script:

1. Parses the vendored XSD (`spec-compliance/ecma-376/schemas/transitional/wml.xsd`)
   via `@xmldom/xmldom`. Walks the element's `complexType`, expanding
   `<xsd:group ref="…">` references to a configurable depth (default
   2 — required to surface `<w:r>` underneath `<w:p>` via
   `EG_PContent → EG_ContentRunContent`).
2. Extracts `word/document.xml` from the local
   `[MS-OE376]-220816.docx` into a SHA-256-keyed cache under
   `scripts/spec-traceability/.cache/` (gitignored).
3. Walks `<w:body>` for top-level `<w:p>` paragraphs, capturing each
   paragraph's `<w:pStyle>` and concatenated `<w:t>` text.
4. Groups paragraphs into sections at every `Heading3` boundary,
   parsing the heading via
   `/^Part\s+(\d+)\s+Section\s+([\d.]+),\s+(\S+)\s+\((.+)\)$/`.
5. Locates the requested element by filtering on `part`, `element`, and
   a section-number prefix (default `2.3` to scope to WML
   paragraph-content elements). Surfaces other matches as candidates.
6. Resolves `see the notes for X, §Y.Z(letter)` cross-references —
   follows the link, finds the labelled `(letter)` block in the target
   section, and pulls its `Definition-Field` / `Definition-Field2` pair
   inline.
7. Emits a single HTML file with the verbatim Microsoft notes, the
   resolved cross-reference (when present), the XSD child table
   (sorted alphabetically with provenance badges), and inline
   `<span data-xsd-ref>` hover markers on XSD-known names in prose.

Output is deterministic: sorted children, stable IDs, no timestamps in
the HTML; re-runs produce byte-identical files.

## Running it

From the repo root:

```bash
node scripts/spec-traceability/extract-element-definition.mjs
```

Defaults target `<w:p>` at Part 4 §2.3 (WordprocessingML
paragraph-content range). Override via flags:

```bash
node scripts/spec-traceability/extract-element-definition.mjs \
  --element=r --section-prefix=2.3

node scripts/spec-traceability/extract-element-definition.mjs \
  --element=pPr --section-prefix=2.7.4
```

Flags:

| Flag | Default |
|---|---|
| `--element` | `p` |
| `--part` | `4` (MS-OE376's 2nd-edition Part numbering) |
| `--section-prefix` | `2.3` (WML paragraph-content range) |
| `--xsd` | `spec-compliance/ecma-376/schemas/transitional/wml.xsd` |
| `--ms-oe376-docx` | `~/Downloads/[MS-OE376]-220816.docx` |
| `--out` | `out/spec-traceability/poc` |
| `--cache` | `scripts/spec-traceability/.cache` |
| `--group-depth` | `2` |

Output: `out/spec-traceability/poc/w-<element>.html`.

If no section matches the `(element, part, prefix)` triple, the script
exits non-zero and prints up to five candidate `(part, section,
description)` triples to help you pick a different prefix. (Example:
running `--element=t` exits because the WordprocessingML text element
has no Microsoft-specific behavior notes in MS-OE376 — a useful
empirical signal about the document's coverage.)

## Tools

- **`@xmldom/xmldom`** for both the XSD and the DOCX `document.xml`.
  Native namespace handling via `getElementsByTagNameNS` matches the
  WHATWG-DOM ergonomics the rest of the codebase already uses.
- **`jszip`** to unzip the `.docx`. (`docx-core` ships it as a
  workspace dep too; added at root because root scripts should not
  rely on workspace hoisting.)

## Not in this PoC

- Multi-document chaining (e.g., follow `[ECMA-376]` references from
  MS-OE376 back into the vendored XSDs for full provenance).
- Coverage reporting (which XSD elements have / lack MS-OE376 entries).
- Wiring into the existing `@conformance` framework or the
  `spec-compliance/registry/ecma-376.md` registry's `verifiedBy:`
  field.
- Any CI integration.
- Tests.
- An OpenSpec change. If this PoC clears its verification checklist,
  the follow-up OpenSpec proposal will live at
  `openspec/changes/add-msoe376-traceability/` and will decide the
  `.docx` vendoring story (the file is under Microsoft's
  open-specifications license and can be redistributed for the purpose
  of documenting implementations).
