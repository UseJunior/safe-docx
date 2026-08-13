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
| `independent-release-verifier` | Covered by finished-artifact replay, package-integrity, and emitted-redline minimality checks. |
| `planned` | Important for safe-docx, but not yet fully modeled, implemented, or claimed. |
| `non-goal` | Explicitly out of scope today; this is tracked so silence is not mistaken for coverage. |

## Priority Slices

| Slice | ECMA-376 area | Current posture | Existing registry anchors | Suggested GitHub issue title |
| --- | --- | --- | --- | --- |
| Tracked run/paragraph revisions | Part 1 §17.13.5 plus Part 1 §17.16.13 for deleted field-code payloads | `partial`, with narrow `formal-checker` coverage for XML triple accept/reject text and field-structure checks | `ECMA-PART1-17-13-5`, `ECMA-PART1-17-13-5-15`, `ECMA-PART1-17-13-5-20`, `ECMA-PART1-17-16-13` | Track ECMA-376 §17.13.5 run and paragraph revision coverage |
| Complex fields | Part 1 §17.16 | `partial`; runtime structural checks cover field markers in compared `word/document.xml`, not full field-code semantics | `ECMA-PART1-17-16-13`, `ECMA-PART1-17-16-18`, `ECMA-PART1-17-16-5-44`, `ECMA-PART1-17-16-5-42` | Track ECMA-376 §17.16 complex-field coverage |
| Paragraph and run properties | Part 1 §17.3 | `partial`; the exposed paragraph subset follows CT_PPr sequence order, supported direct run properties occur at most once, values are runtime-validated, and package load/save preserves authored XML; rendering, layout, computed style inheritance/cascade, semantic formatting comparison, and unimplemented property families are non-goals | `ECMA-PART1-17-3-1-26`, `ECMA-PART1-17-3-2-28`, `ECMA-PART1-17-3-1-19` | Track ECMA-376 §17.3 paragraph/run property coverage |
| Sections, page setup, headers, footers | Part 1 §17.6 and §17.10 | `partial`; generated section/header/footer wiring is claimed, full pagination/rendering is not | `ECMA-PART1-17-6-17`, `ECMA-PART1-17-6-18`, `ECMA-PART1-17-6-13`, `ECMA-PART1-17-6-11`, `ECMA-PART1-17-6-12`, `ECMA-PART1-17-10-1`, `ECMA-PART1-17-10-2`, `ECMA-PART1-17-10-3`, `ECMA-PART1-17-10-4`, `ECMA-PART1-17-10-5`, `ECMA-PART1-17-10-6` | Track ECMA-376 §17.6/§17.10 section and header/footer coverage |
| Tables | Part 1 §17.4 | `partial`; schema-ordered generation, API-subset value/grid validation, and package preservation are evidenced; XSD-valid values outside `DocumentSpec`, rendering, layout outcomes, and tracked table topology revisions remain unsupported or non-goals | `ECMA-PART1-17-4-37`, `ECMA-PART1-17-4-59`, `ECMA-PART1-17-4-63`, `ECMA-PART1-17-4-52`, `ECMA-PART1-17-4-38`, `ECMA-PART1-17-4-48`, `ECMA-PART1-17-4-16`, `ECMA-PART1-17-4-78`, `ECMA-PART1-17-4-81`, `ECMA-PART1-17-4-80`, `ECMA-PART1-17-4-49`, `ECMA-PART1-17-4-65`, `ECMA-PART1-17-4-69`, `ECMA-PART1-17-4-71`, `ECMA-PART1-17-4-17`, `ECMA-PART1-17-4-84`, `ECMA-PART1-17-4-32`, `ECMA-PART1-17-4-83`, `ECMA-PART1-17-4-68`, `ECMA-PART1-17-4-66`, `ECMA-PART1-17-13-5-2`, `ECMA-PART1-17-13-5-36` | Track ECMA-376 §17.4 table coverage |
| Numbering | Part 1 §17.9 plus paragraph `w:numPr` | `partial`; generated definitions/references, API-subset value/reference validation, and package preservation are evidenced; XML integers wider than JavaScript safe integers, rendering, complete overrides, and Word counter behavior are not | `ECMA-PART1-17-9-16`, `ECMA-PART1-17-9-1`, `ECMA-PART1-17-9-2`, `ECMA-PART1-17-9-15`, `ECMA-PART1-17-9-18`, `ECMA-PART1-17-9-3`, `ECMA-PART1-17-9-6`, `ECMA-PART1-17-9-17`, `ECMA-PART1-17-9-11`, `ECMA-PART1-17-9-25`, `ECMA-PART1-17-9-28`, `ECMA-PART1-17-9-12`, `ECMA-PART1-17-9-7`, `ECMA-PART1-17-3-1-19`, `ECMA-PART1-17-13-5-30` | Track ECMA-376 §17.9 numbering coverage |
| Styles and defaults | Part 1 §17.7 | `partial`; generated definitions/defaults/references, API-subset validation, and package preservation are evidenced; schema-valid table/numbering style types, full cascade, latent styles, theme resolution, and rendering are unsupported or non-goals | `ECMA-PART1-17-7-4-18`, `ECMA-PART1-17-7-4-17`, `ECMA-PART1-17-7-5-1` | Track ECMA-376 §17.7 styles coverage |
| Comments, footnotes, and anchors | Part 1 §17.11 and §17.13.4 | `partial`; comments and footnote-reference semantics are claimed for the supported surface | `ECMA-PART1-17-11-14`, `ECMA-PART1-17-13-4-6`, `ECMA-PART1-17-13-4-2`, `ECMA-PART1-17-13-4-4`, `ECMA-PART1-17-13-4-3`, `ECMA-PART1-17-13-4-5` | Track ECMA-376 §17.11/§17.13.4 note and comment coverage |
| Advanced revision records | Part 1 §17.13.5.1–37 plus annotation §§17.13.4, 17.13.6, 17.13.7, and 17.13.8 | `partial`; comparison authors content and detected move records in both modes; accept/reject resolves bounded content, move, and property records; in-place and rebuild preservation differ explicitly; topology, custom XML, annotations, numbering/grid/exception records, and Microsoft conflict extensions remain preservation-only, gaps, or non-goals per operation | `ECMA-PART1-17-13-5-1` through `ECMA-PART1-17-13-5-11`, `ECMA-PART1-17-13-5-21` through `ECMA-PART1-17-13-5-37`, `ECMA-PART1-17-13-4-3`, `ECMA-PART1-17-13-4-4`, `ECMA-PART1-17-13-4-5`, `ECMA-PART1-17-13-6-1`, `ECMA-PART1-17-13-6-2`, `ECMA-PART1-17-13-7-1`, `ECMA-PART1-17-13-7-2`, `ECMA-PART1-17-13-8-1` | Classify advanced revision behavior by operation and reconstruction mode |

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
- Independent-verifier claims identify exactly which final DOCX artifacts and projections they read.
```

## Definition of Done for a Slice

A slice is complete only when:

- supported subsections have registry entries and schema references;
- unsupported subsections are explicit Non-Goals or `@conformance-gap`s;
- source and tests resolve through the citation lints;
- generated `CONFORMANCE.md` and README summary remain up to date; and
- any independent-verifier claim is tied to its concrete artifact input, not to the whole
  TypeScript implementation or to all of ECMA-376.

The operation-specific advanced-revision denominator is
`spec-compliance/manifests/ecma-376-advanced-revisions.json`. Its checker fails
when a runtime revision-vocabulary element is not classified, an operation
lacks element-specific executable evidence, an exact normative subsection
disappears, evidence is only tag-stuffed into a file, or verifier scope drifts.
