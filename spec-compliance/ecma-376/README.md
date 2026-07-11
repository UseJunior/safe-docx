# ECMA-376 vendored normative schemas

This directory holds the unchanged official ECMA-376 ZIP publications under
`source-artifacts/` and unmodified extracted schema copies under `schemas/`.
The ZIPs, including their PDF narrative parts, are the immutable upstream
source. The extracted schemas remain the convenient declaration-resolution
surface used by the existing conformance registry.

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

## Source artifacts and derived schemas

The official ZIPs are recorded in
`../manifests/ecma-376-artifacts.json` with SHA-256 identities. Generated
vocabulary is read directly from the nested XSD archive in the Part 4 ZIP and
records that input checksum. The extracted XSDs encode the **machine-readable** structural rules of ECMA-376 —
element names, attribute types, restrictions, enumerations, and value
patterns. A `@conformance` claim that names `wml.xsd#element:delInstrText`
resolves without leaving the repo. The PDFs remain inside the unchanged ZIPs;
section-level locators in the spec-reference manifest identify their source
artifact and section.

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
