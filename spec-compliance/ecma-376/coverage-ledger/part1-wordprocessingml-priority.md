# ECMA-376 Part 1 §17 WordprocessingML Priority Ledger

This ledger is the working map for the next tranche of ECMA-376 coverage. It is
not a claim that the full 6,000-page standard is covered. The current
machine-enforced claims remain in `spec-compliance/registry/ecma-376.md` and the
generated `spec-compliance/CONFORMANCE.md`.

Scope for this pass: **ECMA-376 5th edition, Part 1 §17 (WordprocessingML)**.
This is the highest-value section for safe-docx because the MCP server edits,
compares, accepts/rejects revisions, and emits WordprocessingML documents.

## Status Key

| Status | Meaning |
| --- | --- |
| `claimed` | A registry entry exists and source/tests cite it through the conformance machinery. |
| `partial` | Some important subsections are claimed, but the section family is not fully covered. |
| `formal-checker` | Covered by the current Lean XML triple checker for its narrow DOCX comparison scope. |
| `planned` | Important for safe-docx, but not yet fully modeled, implemented, or claimed. |
| `non-goal` | Explicitly out of scope today; this is tracked so silence is not mistaken for coverage. |

## Priority Slices

| Slice | ECMA-376 area | Current posture | Existing registry anchors | Suggested GitHub issue title |
| --- | --- | --- | --- | --- |
| Tracked run/paragraph revisions | Part 1 §17.13.5 plus Part 1 §17.16.13 for deleted field-code payloads | `partial`, with narrow `formal-checker` coverage for XML triple accept/reject text and field-structure checks | `ECMA-PART1-17-13-5`, `ECMA-PART1-17-13-5-15`, `ECMA-PART1-17-13-5-20`, `ECMA-PART1-17-16-13` | Track ECMA-376 §17.13.5 run and paragraph revision coverage |
| Complex fields | Part 1 §17.16 | `partial`, with Lean checker coverage for field markers in compared `word/document.xml`; not full field-code semantics | `ECMA-PART1-17-16-13`, `ECMA-PART1-17-16-18`, `ECMA-PART1-17-16-5-44`, `ECMA-PART1-17-16-5-42` | Track ECMA-376 §17.16 complex-field coverage |
| Paragraph and run properties | Part 1 §17.3 | `partial`; the exposed direct-formatting subset is emitted in schema order, validated, and preserved by package load/save; rendering, layout, computed style inheritance/cascade, semantic formatting comparison, and unimplemented property families are non-goals | `ECMA-PART1-17-3-1-26`, `ECMA-PART1-17-3-2-28`, `ECMA-PART1-17-3-1-19` | Track ECMA-376 §17.3 paragraph/run property coverage |
| Sections, page setup, headers, footers | Part 1 §17.6 and §17.10 | `partial`; generated section/header/footer wiring is claimed, full pagination/rendering is not | `ECMA-PART1-17-6-17`, `ECMA-PART1-17-6-18`, `ECMA-PART1-17-6-13`, `ECMA-PART1-17-6-11`, `ECMA-PART1-17-6-12`, `ECMA-PART1-17-10-1`, `ECMA-PART1-17-10-2`, `ECMA-PART1-17-10-3`, `ECMA-PART1-17-10-4`, `ECMA-PART1-17-10-5`, `ECMA-PART1-17-10-6` | Track ECMA-376 §17.6/§17.10 section and header/footer coverage |
| Tables | Part 1 §17.4 | `partial`; table generation and selected fidelity checks are claimed, tracked table topology revisions remain non-goals | `ECMA-PART1-17-4-37`, `ECMA-PART1-17-4-59`, `ECMA-PART1-17-4-63`, `ECMA-PART1-17-4-52`, `ECMA-PART1-17-4-38`, `ECMA-PART1-17-4-48`, `ECMA-PART1-17-4-16`, `ECMA-PART1-17-4-78`, `ECMA-PART1-17-4-81`, `ECMA-PART1-17-4-80`, `ECMA-PART1-17-4-49`, `ECMA-PART1-17-4-65`, `ECMA-PART1-17-4-69`, `ECMA-PART1-17-4-71`, `ECMA-PART1-17-4-17`, `ECMA-PART1-17-4-84`, `ECMA-PART1-17-4-32`, `ECMA-PART1-17-4-83`, `ECMA-PART1-17-4-68`, `ECMA-PART1-17-4-66`, `ECMA-PART1-17-13-5-2`, `ECMA-PART1-17-13-5-36` | Track ECMA-376 §17.4 table coverage |
| Numbering | Part 1 §17.9 plus paragraph `w:numPr` | `partial`; generation wiring is claimed, full Word numbering behavior and all overrides are not | `ECMA-PART1-17-9-16`, `ECMA-PART1-17-9-1`, `ECMA-PART1-17-9-2`, `ECMA-PART1-17-9-15`, `ECMA-PART1-17-9-18`, `ECMA-PART1-17-9-3`, `ECMA-PART1-17-9-6`, `ECMA-PART1-17-9-17`, `ECMA-PART1-17-9-11`, `ECMA-PART1-17-9-25`, `ECMA-PART1-17-9-28`, `ECMA-PART1-17-9-12`, `ECMA-PART1-17-9-7`, `ECMA-PART1-17-3-1-19`, `ECMA-PART1-17-13-5-30` | Track ECMA-376 §17.9 numbering coverage |
| Styles and defaults | Part 1 §17.7 | `partial`; generated style parts/defaults are claimed, full latent styles/theme interactions are not | `ECMA-PART1-17-7-4-18`, `ECMA-PART1-17-7-4-17`, `ECMA-PART1-17-7-5-1` | Track ECMA-376 §17.7 styles coverage |
| Comments, footnotes, and anchors | Part 1 §17.11 and §17.13.4 | `partial`; comments and footnote-reference semantics are claimed for the supported surface | `ECMA-PART1-17-11-14`, `ECMA-PART1-17-13-4-6`, `ECMA-PART1-17-13-4-2`, `ECMA-PART1-17-13-4-4`, `ECMA-PART1-17-13-4-3`, `ECMA-PART1-17-13-4-5` | Track ECMA-376 §17.11/§17.13.4 note and comment coverage |
| Moves and property-revision records | Part 1 §17.13.5 move, numbering, section, table-property revision records | `non-goal` today except where expressed as delete plus insert | `ECMA-PART1-17-13-5-21`, `ECMA-PART1-17-13-5-30`, `ECMA-PART1-17-13-5-34`, `ECMA-PART1-17-13-5-36` | Track non-goal status for ECMA-376 advanced revision records |

## Issue Template

Use this issue shape when opening GitHub tracking issues from the table above:

```markdown
Title: Track ECMA-376 <section> <topic> coverage

Scope:
- ECMA-376 edition 5, Part 1 §<section>
- Registry IDs: <ids>

Acceptance:
- Registry entries exist for every supported subsection in scope.
- Unsupported subsections are listed as Non-Goals or conformance gaps.
- Source claims use @conformance / @conformance-gap.
- Tests use testAllure.conformance({ spec: 'ECMA-376', edition: 5, part: 1, section: '<section>' }).
- If a Lean verifier claim is involved, the checker coverage ledger says exactly which XML/docx inputs it reads.
```

## Definition of Done for a Slice

A slice is complete only when:

- supported subsections have registry entries and schema references;
- unsupported subsections are explicit Non-Goals or `@conformance-gap`s;
- source and tests resolve through the citation lints;
- generated `CONFORMANCE.md` and README summary remain up to date; and
- any Lean-backed claim is tied to the concrete checker input, not to the whole
  TypeScript implementation or to all of ECMA-376.
