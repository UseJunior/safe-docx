# SafeDocX Capability Projection

Pinned neutral registry: `open-agreements/docx-platform-tests@09e4c2c8a2fac214a1f02ed787e8ed9a0404217b`

Profile: `current-neutral-surface` (registry version 1)

This report preserves the upstream profile denominator. It does not claim full ECMA-376 coverage, and a positive row applies only to the listed evidence and scope.

## Formal Assurance Boundary

The registry `verification/registry/lean-xml-checker-coverage.json` is scope metadata only and establishes **no capability row** in this projection.

Covered reconstruction mode: inplace. Excluded mode: rebuild.

Covered stories: main, footnotes, endnotes. Projections: text and field markers only.

Exact covered surfaces: word/document.xml text and field-marker token stream (required); word/footnotes.xml user-note text and field-marker token stream (optional; absent sides modeled as empty when any side is present); word/endnotes.xml user-note text and field-marker token stream (optional; absent sides modeled as empty when any side is present).

Exact excluded surfaces: word/comments.xml and all comment anchors, reference IDs, relationships, extension parts, and thread semantics; numbering.xml; document relationships; styles.xml; settings.xml; headers; footers.

Exact known unchecked areas: full ECMA-376 schema validation; rendering equivalence; formatting fidelity; bookmark semantic equivalence; comments.xml and comment anchor, reference-ID, relationship, extension-part, and thread integrity; footnote and endnote definition/reference integrity, including reference IDs and relationships; relationship target integrity; package-level OPC constraints; field instruction parsing, evaluation, and cached-result correctness, including PAGE and NUMPAGES semantics; OOXML extension and compatibility markup; advanced revision-record semantics, including property snapshots, move-range pairing, numbering/table/style revisions, custom XML revisions, conflict records, and annotation interactions; general-purpose XML canonicalization, DTDs, and CDATA beyond the checked WordprocessingML token surface.

## Denominator

Profile capability/axis pairs: **59**

| Axis | Pairs |
|---|---:|
| generate | 13 |
| edit | 15 |
| acceptReject | 10 |
| crossPlatform | 21 |

## Evidence Inventory

These counts are not interchangeable denominators. The profile cross-product includes explicit untested and gap rows; the summary contains only authored or measured evidence rows.

| Count | Value | Meaning |
|---|---:|---|
| Profile capability/axis pairs | 59 | Every applicable pair selected by the pinned profile |
| Authored mapping pairs | 26 | Distinct capability/axis pairs with neutral scenarios |
| Complete-run derived cross-platform pairs | 21 | One potential cross-platform row per mapped capability |
| Expected complete summary rows | 47 | 26 authored plus 21 derived rows |
| Pinned measured summary rows | 8 | Rows actually backed by the pinned result snapshot |
| Pinned measured / unmeasured scenarios | 12 / 25 | Result-snapshot state at the pinned commit |

## Status Counts

| Status | Pairs |
|---|---:|
| supported | 8 |
| partial | 0 |
| preservation-only | 0 |
| gap | 3 |
| non-goal | 0 |
| untested | 48 |

## Evidence Projection

| Capability | Axis | Status | Scope | Version / verified commit | Evidence | Rationale |
|---|---|---|---|---|---|---|
| `word.comments.anchors` | crossPlatform | untested | `word/document.xml`, `word/comments.xml`<br>stories: main, comments<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | The pinned neutral result set has no measured cross-platform row for this pair. |
| `word.comments.anchors` | edit | untested | `word/document.xml`, `word/comments.xml`<br>stories: main, comments<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | Local tests lack structured capability-and-axis metadata, so this pair is untested in this projection. |
| `word.comments.anchors` | generate | untested | `word/document.xml`, `word/comments.xml`<br>stories: main, comments<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | No pinned neutral result or mapped local executable evidence is asserted for this pair. |
| `word.comments.content` | crossPlatform | untested | `word/comments.xml`<br>stories: comments<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | The pinned neutral result set has no measured cross-platform row for this pair. |
| `word.comments.content` | edit | untested | `word/comments.xml`<br>stories: comments<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | Local tests lack structured capability-and-axis metadata, so this pair is untested in this projection. |
| `word.comments.content` | generate | untested | `word/comments.xml`<br>stories: comments<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | No pinned neutral result or mapped local executable evidence is asserted for this pair. |
| `word.comments.removal` | crossPlatform | untested | `word/document.xml`, `word/comments.xml`<br>stories: main, comments<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | The pinned neutral result set has no measured cross-platform row for this pair. |
| `word.comments.removal` | edit | untested | `word/document.xml`, `word/comments.xml`<br>stories: main, comments<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | Local tests lack structured capability-and-axis metadata, so this pair is untested in this projection. |
| `word.footers.default` | crossPlatform | untested | `word/document.xml`, `word/_rels/document.xml.rels`, `word/footer*.xml`<br>stories: main, footers<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | The pinned neutral result set has no measured cross-platform row for this pair. |
| `word.footers.default` | edit | untested | `word/document.xml`, `word/_rels/document.xml.rels`, `word/footer*.xml`<br>stories: main, footers<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | No pinned neutral result or mapped local executable evidence is asserted for this pair. |
| `word.footers.default` | generate | untested | `word/document.xml`, `word/_rels/document.xml.rels`, `word/footer*.xml`<br>stories: main, footers<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | Local tests lack structured capability-and-axis metadata, so this pair is untested in this projection. |
| `word.headers.default` | crossPlatform | untested | `word/document.xml`, `word/_rels/document.xml.rels`, `word/header*.xml`<br>stories: main, headers<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | The pinned neutral result set has no measured cross-platform row for this pair. |
| `word.headers.default` | edit | untested | `word/document.xml`, `word/_rels/document.xml.rels`, `word/header*.xml`<br>stories: main, headers<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | No pinned neutral result or mapped local executable evidence is asserted for this pair. |
| `word.headers.default` | generate | untested | `word/document.xml`, `word/_rels/document.xml.rels`, `word/header*.xml`<br>stories: main, headers<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | Local tests lack structured capability-and-axis metadata, so this pair is untested in this projection. |
| `word.hyperlinks.external` | crossPlatform | untested | `word/document.xml`, `word/_rels/document.xml.rels`<br>stories: main<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | The pinned neutral result set has no measured cross-platform row for this pair. |
| `word.hyperlinks.external` | edit | untested | `word/document.xml`, `word/_rels/document.xml.rels`<br>stories: main<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | No pinned neutral result or mapped local executable evidence is asserted for this pair. |
| `word.hyperlinks.external` | generate | untested | `word/document.xml`, `word/_rels/document.xml.rels`<br>stories: main<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | No pinned neutral result or mapped local executable evidence is asserted for this pair. |
| `word.numbering.paragraph` | crossPlatform | untested | `word/document.xml`, `word/numbering.xml`, `word/_rels/document.xml.rels`<br>stories: main<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | The pinned neutral result set has no measured cross-platform row for this pair. |
| `word.numbering.paragraph` | edit | untested | `word/document.xml`, `word/numbering.xml`, `word/_rels/document.xml.rels`<br>stories: main<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | No pinned neutral result or mapped local executable evidence is asserted for this pair. |
| `word.numbering.paragraph` | generate | untested | `word/document.xml`, `word/numbering.xml`, `word/_rels/document.xml.rels`<br>stories: main<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | Local tests lack structured capability-and-axis metadata, so this pair is untested in this projection. |
| `word.paragraphs.structure` | acceptReject | untested | `word/document.xml`<br>stories: main<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | Local tests lack structured capability-and-axis metadata, so this pair is untested in this projection. |
| `word.paragraphs.structure` | crossPlatform | untested | `word/document.xml`<br>stories: main<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | The pinned neutral result set has no measured cross-platform row for this pair. |
| `word.paragraphs.structure` | edit | untested | `word/document.xml`<br>stories: main<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | Local tests lack structured capability-and-axis metadata, so this pair is untested in this projection. |
| `word.paragraphs.structure` | generate | untested | `word/document.xml`<br>stories: main<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | Local tests lack structured capability-and-axis metadata, so this pair is untested in this projection. |
| `word.revisions.content` | acceptReject | supported | `word/document.xml`<br>stories: main<br>mode: not-applicable | 0.15.0 / `459051c072daca16cf02d8406c439d81281d382f` | normative-behavioral-scenario: `spec-compliance/capabilities/upstream/capability-summary.json`<br>0.15.0 / `459051c072daca16cf02d8406c439d81281d382f` | Every mapped scenario in the pinned neutral result row is pass-like for SafeDocX. |
| `word.revisions.content` | crossPlatform | supported | `word/document.xml`<br>stories: main<br>mode: not-applicable | 0.15.0 / `459051c072daca16cf02d8406c439d81281d382f` | cross-implementation-differential: `spec-compliance/capabilities/upstream/capability-summary.json`<br>0.15.0 / `459051c072daca16cf02d8406c439d81281d382f` | Every mapped scenario in the pinned neutral result row is pass-like for SafeDocX and at least one other adapter. |
| `word.revisions.moves` | acceptReject | untested | `word/document.xml`<br>stories: main<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | Local tests lack structured capability-and-axis metadata, so this pair is untested in this projection. |
| `word.revisions.moves` | crossPlatform | untested | `word/document.xml`<br>stories: main<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | The pinned neutral result set has no measured cross-platform row for this pair. |
| `word.revisions.paragraph-mark` | acceptReject | supported | `word/document.xml`<br>stories: main<br>mode: not-applicable | 0.15.0 / `459051c072daca16cf02d8406c439d81281d382f` | normative-behavioral-scenario: `spec-compliance/capabilities/upstream/capability-summary.json`<br>0.15.0 / `459051c072daca16cf02d8406c439d81281d382f` | Every mapped scenario in the pinned neutral result row is pass-like for SafeDocX. |
| `word.revisions.paragraph-mark` | crossPlatform | supported | `word/document.xml`<br>stories: main<br>mode: not-applicable | 0.15.0 / `459051c072daca16cf02d8406c439d81281d382f` | cross-implementation-differential: `spec-compliance/capabilities/upstream/capability-summary.json`<br>0.15.0 / `459051c072daca16cf02d8406c439d81281d382f` | Every mapped scenario in the pinned neutral result row is pass-like for SafeDocX and at least one other adapter. |
| `word.revisions.paragraph-properties` | acceptReject | untested | `word/document.xml`<br>stories: main<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | Local tests lack structured capability-and-axis metadata, so this pair is untested in this projection. |
| `word.revisions.paragraph-properties` | crossPlatform | untested | `word/document.xml`<br>stories: main<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | The pinned neutral result set has no measured cross-platform row for this pair. |
| `word.revisions.run-properties` | acceptReject | supported | `word/document.xml`<br>stories: main<br>mode: not-applicable | 0.15.0 / `459051c072daca16cf02d8406c439d81281d382f` | normative-behavioral-scenario: `spec-compliance/capabilities/upstream/capability-summary.json`<br>0.15.0 / `459051c072daca16cf02d8406c439d81281d382f` | Every mapped scenario in the pinned neutral result row is pass-like for SafeDocX. |
| `word.revisions.run-properties` | crossPlatform | supported | `word/document.xml`<br>stories: main<br>mode: not-applicable | 0.15.0 / `459051c072daca16cf02d8406c439d81281d382f` | cross-implementation-differential: `spec-compliance/capabilities/upstream/capability-summary.json`<br>0.15.0 / `459051c072daca16cf02d8406c439d81281d382f` | Every mapped scenario in the pinned neutral result row is pass-like for SafeDocX and at least one other adapter. |
| `word.revisions.table-rows` | acceptReject | gap | `word/document.xml`<br>stories: main<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | Inserted and deleted table-row resolution has no passing pinned evidence and remains an explicit conformance gap. |
| `word.revisions.table-rows` | crossPlatform | untested | `word/document.xml`<br>stories: main<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | The pinned neutral result set has no measured cross-platform row for this pair. |
| `word.runs.formatting` | acceptReject | untested | `word/document.xml`<br>stories: main<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | Local tests lack structured capability-and-axis metadata, so this pair is untested in this projection. |
| `word.runs.formatting` | crossPlatform | untested | `word/document.xml`, `word/styles.xml`<br>stories: main<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | The pinned neutral result set has no measured cross-platform row for this pair. |
| `word.runs.formatting` | edit | untested | `word/document.xml`<br>stories: main<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | Local tests lack structured capability-and-axis metadata, so this pair is untested in this projection. |
| `word.runs.formatting` | generate | untested | `word/document.xml`<br>stories: main<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | Local tests lack structured capability-and-axis metadata, so this pair is untested in this projection. |
| `word.styles.paragraph` | crossPlatform | untested | `word/document.xml`, `word/styles.xml`, `word/_rels/document.xml.rels`<br>stories: main<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | The pinned neutral result set has no measured cross-platform row for this pair. |
| `word.styles.paragraph` | edit | untested | `word/document.xml`, `word/styles.xml`, `word/_rels/document.xml.rels`<br>stories: main<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | No pinned neutral result or mapped local executable evidence is asserted for this pair. |
| `word.styles.paragraph` | generate | untested | `word/document.xml`, `word/styles.xml`, `word/_rels/document.xml.rels`<br>stories: main<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | Local tests lack structured capability-and-axis metadata, so this pair is untested in this projection. |
| `word.tables.cells` | crossPlatform | untested | `word/document.xml`<br>stories: main<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | The pinned neutral result set has no measured cross-platform row for this pair. |
| `word.tables.cells` | edit | untested | `word/document.xml`<br>stories: main<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | No pinned neutral result or mapped local executable evidence is asserted for this pair. |
| `word.tables.cells` | generate | untested | `word/document.xml`<br>stories: main<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | Local tests lack structured capability-and-axis metadata, so this pair is untested in this projection. |
| `word.tables.horizontal-merge` | crossPlatform | untested | `word/document.xml`<br>stories: main<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | The pinned neutral result set has no measured cross-platform row for this pair. |
| `word.tables.horizontal-merge` | edit | untested | `word/document.xml`<br>stories: main<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | No pinned neutral result or mapped local executable evidence is asserted for this pair. |
| `word.tables.horizontal-merge` | generate | untested | `word/document.xml`<br>stories: main<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | Local tests lack structured capability-and-axis metadata, so this pair is untested in this projection. |
| `word.tables.rows` | acceptReject | gap | `word/document.xml`<br>stories: main<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | Inserted and deleted table-row resolution has no passing pinned evidence and remains an explicit conformance gap. |
| `word.tables.rows` | crossPlatform | untested | `word/document.xml`<br>stories: main<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | The pinned neutral result set has no measured cross-platform row for this pair. |
| `word.tables.rows` | edit | untested | `word/document.xml`<br>stories: main<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | No pinned neutral result or mapped local executable evidence is asserted for this pair. |
| `word.tables.rows` | generate | untested | `word/document.xml`<br>stories: main<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | No pinned neutral result or mapped local executable evidence is asserted for this pair. |
| `word.tables.structure` | acceptReject | gap | `word/document.xml`<br>stories: main<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | The profile pair is not established by current table-revision evidence. |
| `word.tables.structure` | crossPlatform | untested | `word/document.xml`<br>stories: main<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | The pinned neutral result set has no measured cross-platform row for this pair. |
| `word.tables.structure` | edit | untested | `word/document.xml`<br>stories: main<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | No pinned neutral result or mapped local executable evidence is asserted for this pair. |
| `word.tables.structure` | generate | untested | `word/document.xml`<br>stories: main<br>mode: not-applicable | 0.16.0 / `4ea2a263dc199cb81132a6580a5d22785fcda7e3` | none | Local tests lack structured capability-and-axis metadata, so this pair is untested in this projection. |
| `word.text.find-replace` | crossPlatform | supported | `word/document.xml`<br>stories: main<br>mode: not-applicable | 0.15.0 / `459051c072daca16cf02d8406c439d81281d382f` | cross-implementation-differential: `spec-compliance/capabilities/upstream/capability-summary.json`<br>0.15.0 / `459051c072daca16cf02d8406c439d81281d382f` | Every mapped scenario in the pinned neutral result row is pass-like for SafeDocX and at least one other adapter. |
| `word.text.find-replace` | edit | supported | `word/document.xml`<br>stories: main<br>mode: not-applicable | 0.15.0 / `459051c072daca16cf02d8406c439d81281d382f` | normative-behavioral-scenario: `spec-compliance/capabilities/upstream/capability-summary.json`<br>0.15.0 / `459051c072daca16cf02d8406c439d81281d382f` | Every mapped scenario in the pinned neutral result row is pass-like for SafeDocX. |
