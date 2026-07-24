# Change: Add paragraph borders to DOCX generation

## Why

`ParagraphSpec` cannot currently express `w:pBdr`, forcing consumers to use
one-cell tables for simple paragraph rules. Those layout-only tables can trigger
import warnings in Apple Pages when used in headers.

## What Changes

- Add paragraph-border data to `ParagraphSpec`, reusing `BorderSpec`.
- Emit ordered `w:pBdr` paragraph properties for supported edges.
- Validate paragraph-border values through the existing border validator.
- Add generation, schema, and compare/round-trip evidence for a bottom-bordered
  header-rule paragraph.

## Impact

- Affected specs: `docx-generation`
- Affected code: `packages/docx-core/src/generation`
- Compatibility: additive API change; existing specs emit identical output

