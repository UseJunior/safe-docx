## 1. Specification and conformance

- [ ] 1.1 Validate this OpenSpec proposal and delta requirements.
- [ ] 1.2 Register the exact ECMA-376 edition 5 sections for paragraph outline
  levels and numbering-level paragraph-style associations.
- [ ] 1.3 Add conformance JSDoc and Allure citations only where behavior is
  grounded in normative OOXML structure.

## 2. Deterministic metadata parsing

- [ ] 2.1 Add effective `outlineLevel` resolution to paragraph formatting,
  including direct-over-style precedence, 0..8 mapping, body-text value 9, and
  malformed-value handling.
- [ ] 2.2 Retain optional `pStyle` on numbering levels and expose a read-only
  lookup for a paragraph's active `numId`/`ilvl`.
- [ ] 2.3 Add the maintained localized built-in heading alias table for English,
  French, German, Spanish, and Japanese.

## 3. Classification and agent surface

- [ ] 3.1 Extend `HeadingSource` with `list_metadata` and `outline_level`
  without changing existing source values.
- [ ] 3.2 Apply the documented first-match precedence and support Heading 1
  through Heading 9.
- [ ] 3.3 Include every deterministic source in the default
  `get_document_outline` projection while retaining heuristic opt-in.
- [ ] 3.4 Document the complete `HeadingValue` shape, taxonomy, precedence, and
  Markdown depth clamp in generated MCP reference material.

## 4. Tests

- [ ] 4.1 Cover direct and inherited `w:outlineLvl`, body-text value 9,
  malformed values, and direct-over-style precedence.
- [ ] 4.2 Cover active numbering levels linked to heading styles, mismatched
  levels, missing definitions, and conflicting deterministic evidence.
- [ ] 4.3 Cover every localized alias entry, literal Heading 1..9 IDs, and
  explicit negative `TOC` cases.
- [ ] 4.4 Cover nested 1 → 2 → 1 outline order, default deterministic inclusion,
  heuristic opt-in, table behavior, and Markdown level clamping.

## 5. Verification and delivery

- [ ] 5.1 Regenerate tool reference and OpenSpec traceability artifacts.
- [ ] 5.2 Run focused tests and every mandatory repository pre-submit gate.
- [ ] 5.3 Review the diff for bounded scope and commit with `Ref: #206`.
