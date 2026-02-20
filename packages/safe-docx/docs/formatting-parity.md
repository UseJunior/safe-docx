# Safe-Docx TS Formatting Parity Notes

## Fingerprint Normalization Rules

Safe-Docx TypeScript uses paragraph-level formatting fingerprints to derive stable `style` IDs in `read_file` output.

Normalization rules:

- Ignore volatile OOXML attributes (for example `w:rsid*`, revision IDs, timestamps).
- Include stable layout/style signals only:
  - paragraph style name
  - paragraph alignment
  - paragraph indentation values
  - list level context
- Use deterministic fingerprint keying so repeated reads in a session keep the same `style` for unchanged paragraphs.

Expected behavior:

- Equivalent formatting in two documents should produce equal fingerprints.
- A paragraph style change should produce a new fingerprint/style ID.

## Refusal Modes and Remediation

Safe-Docx rejects unsafe edits instead of risking malformed output.

Common refusal cases:

- `old_string` is ambiguous or not uniquely resolvable in the target paragraph.
- Requested replacement crosses unsafe container boundaries (for example hyperlinks or structured document tags/SDTs).
- Edit would require unsafe field rewrites (`w:fldChar`/`w:instrText` structure risk).

How to remediate:

1. Narrow `old_string` to a unique, local span in one paragraph.
2. Use smaller edits that avoid crossing hyperlink/SDT boundaries.
3. Edit plain visible text around fields instead of through field structures.
