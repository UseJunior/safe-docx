# Change: Add template-backed greenfield Markdoc generation

## Why

`docx-markdoc` can derive clean and tracked brownfield artifacts from a pinned
source, but it cannot create a new form in an existing house style. Callers
currently clone a DOCX, clear its body, author OOXML paragraphs, and build their
own hash evidence outside the compiler. That breaks the canonical-source and
certificate boundary that Markdoc is intended to provide.

## What Changes

- Add a `compile-greenfield` CLI and library entry point that accepts a
  template DOCX, tag-free canonical Markdoc body, and an optional declarative
  style profile.
- Replace only the supported template body content while retaining the
  template's styles, numbering, theme, section setup, and selected
  header/footer package graph.
- Map plain paragraphs and ATX headings to validated existing paragraph style
  IDs without copying substantive template body text into the new document.
- Emit a clean DOCX plus a certificate binding the canonical, template,
  optional profile, and output hashes and proving unchanged package parts.
- Fail before output for unsupported Markdown, missing styles, multi-section
  body topology, revisions, fields, or body relationships that would make
  replacement ambiguous.

## Impact

- Affected specs: `docx-markdoc`
- Affected code: Markdoc CLI/library exports, greenfield parsing and template
  projection, certificate types, package-part verification, README, and real
  template-backed tests
- Resolves the template-backed greenfield slice of #998 without changing the
  brownfield compiler, comparison alignment, or tracked-change semantics
