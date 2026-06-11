# ECMA-376 vendored normative schemas

This directory holds unmodified copies of the XML schemas distributed with
ECMA-376, 5th Edition (Office Open XML File Formats). The PDF narrative parts
of the standard are **not** vendored here — they remain at the canonical
[Ecma International download page](https://ecma-international.org/publications-and-standards/standards/ecma-376/).

The conformance registry at `../registry/ecma-376.md` binds safe-docx claims
to specific declarations in these files via `schemaRef:` fields.

## Editions and sources

| Part | Title                                        | Edition / date          | Source archive                                          |
| ---- | -------------------------------------------- | ----------------------- | ------------------------------------------------------- |
| 1    | Fundamentals and Markup Language Reference   | 5th Edition / Dec 2016  | `ECMA-376-1_5th_edition_december_2016.zip`              |
| 2    | Open Packaging Conventions                   | 5th Edition / Dec 2021  | `ECMA-376-2_5th_edition_december_2021.zip`              |
| 4    | Transitional Migration Features              | 5th Edition / Dec 2016  | `ECMA-376-4_5th_edition_december_2016.zip`              |

Part 3 (Markup Compatibility and Extensibility) ships no schema files, only
prose.

## What's inside

```
schemas/
  strict/        Part 1 5th edition XSDs — the "Strict" Office Open XML
                 conformance class (21 files, ~876 KB).  NORMATIVE.
  transitional/  Part 4 5th edition XSDs — the "Transitional" conformance
                 class that Word actually emits (26 files, ~968 KB; superset
                 of Strict, adds VML).  NORMATIVE.
  opc/           Part 2 5th edition XSDs — Open Packaging Conventions
                 (4 files, ~16 KB).  NORMATIVE.
                 Note: OPC schemas use the `xs:` namespace prefix; Part 1
                 and Part 4 use `xsd:`.
  relaxng/       RELAX NG equivalents of the above (Part 1 Strict + Part 4
                 Transitional).  INFORMATIVE per ECMA-376 Annex D.
                 Kept for completeness but not used by the conformance lint.
```

A sibling `validation/` directory (NOT part of ECMA-376) holds the
safe-docx-authored entry schema used by the emitted-document schema gate
(`scripts/check_emitted_document_schema.mjs`), plus a vendored copy of the
W3C `xml.xsd` that the ECMA-376 schemas import without a schemaLocation.
Nothing under `schemas/` is modified to make validation work.

## Why XSDs and not PDFs?

The XSDs encode the **machine-readable** structural rules of ECMA-376 —
element names, attribute types, restrictions, enumerations, and value
patterns. A `@conformance` claim that names `wml.xsd#element:delInstrText`
resolves without leaving the repo. The PDFs (the human-readable narrative)
total ~48 MB and are deferred to a coordinated follow-up change
(`vendor-ecma-376-pdfs`); section-level URLs in the registry's `url:` field
link to the canonical Ecma download page in the meantime.

## License

These files are reproduced here under Ecma International's text copyright
policy as unmodified copies with the full notice preserved. See
[`COPYRIGHT.txt`](./COPYRIGHT.txt). Do not modify any file under `schemas/`;
the lint enforces that the registry's `schemaRef:` entries continue to
resolve against the vendored declarations.

If you need to refresh these files against a newer edition of ECMA-376,
re-extract from the canonical archives, replace the contents under
`schemas/`, update this README's edition table, and run
`npm run check:conformance-citations` to confirm no registry entry has
silently broken.
