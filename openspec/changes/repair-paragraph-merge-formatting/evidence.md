# Paragraph-merge decision evidence

## Normative audit

The vendored ECMA-376 edition 5 Part 1 artifact was extracted locally and the complete element descriptions and examples for sections 17.13.5.15 and 17.13.5.20 inspected (printed pages 846-847 and 857). They describe a tracked paragraph delimiter and the combination of adjacent paragraph content. These passages do not establish the previous universal following-paragraph formatting rule. The formatting choice below is an explicitly reader-characterized implementation policy, not a claim that the standard mandates a particular formatting winner. Word has not been verified.

Section 17.3.1.26 and the vendored CT_PPr sequence govern property ordering. The helper preserves that order, retains the surviving section, and preserves pending revision markers independently from the chosen paragraph-mark font formatting.

## Reader matrix

Measured on LibreOffice 26.2.5.2, revision `cd7284b4cbbfeb507e630c1aac019f4157393acb`, using actual AcceptAllTrackedChanges/RejectAllTrackedChanges dispatches. The first paragraph is right aligned, the second centered. Only the first paragraph's break is revised.

| Projection | First text survives | Second text survives | Formatting owner |
|---|---|---|---|
| Accept | no | no | second |
| Accept | no | yes | second |
| Accept | yes | no | first |
| Accept | yes | yes | first |
| Reject | no | no | first |
| Reject | no | yes | second |
| Reject | yes | no | first |
| Reject | yes | yes | first |

The full table was repeated with inherited numbering, direct numbering, and explicit numId=0 suppression. Each output was compared with an independently loaded clean control, including list participation and suppression flags. The plain matrix uses the same implicit paragraph style with different direct alignment; the numbered matrix uses distinct Alpha/Beta styles.

A further DOCX-export control gave the first paragraph a red, 20-point paragraph-mark font and the second a blue, 10-point mark. Both Accept and Reject retained the first mark's red/20-point properties when first content survived. These are committed as actual-reader regressions, not an unexecuted inference about run properties.

Initial native regression run: five of eight cases failed against the prior unconditional following-format rule; the independent plain reader matrix passed. After the initial repair, 133 focused tests passed. Added native cascading/partial-content and pending-revision/section-preservation regressions also passed. Final full-suite, corpus and shipping evidence remain separately gated in tasks.md.

## Public-document causal controls

Public NVCA Management Rights Letter, locally SHA-pinned to the repository manifest. Diagnostic copies and renders remain ignored/local. No private document was used.

- Existing synthetic pPrChange: Reject loses the paragraph number.
- Original properties with preceding deleted break: reader Accept and Reject match all 33 measured paragraph/heading entries; old native Accept assigns Heading1 to an unchanged BodyText predecessor.
- Original properties with conventional source break: reader Accept leaves an additional empty paragraph, 34 versus 33.
- Symmetric preceding boundaries for note-bearing deletion/insertion, original properties retained: reader Accept and Reject match all 33 measured entries without synthetic paragraph-format changes.

The reader comparison includes text, note binding, style, outline and numbering suppression/list-header flags. It is not by itself evidence of every font/layout property. Final rendered numbering inspection is required before shipping.

## Deliberate limits

The release verifier's independent projection returns paragraph text, not paragraph formatting; it remains unchanged and is not counted as a formatting voter. Break removal remains mark-based. Tables, annotation boundaries and sections retain conservative serializer guards. Word is UNVERIFIED. Unsupported reader behavior must be characterized, not hidden by accepting schema-only or text-only checks.

## Shipping hold: field-bearing paragraph conflict

**September 15 resolution:** owner approved the field-aware extension. A control deleting complete field boundaries together with their code/result retains the following paragraph format in LibreOffice; the previous unwrapped-boundary shape retains the leading format. The serializer had exempted only exactly one begin/separate/end sequence from hoisting. Two complete fields were therefore left alive. A stack-validated complete sequence exemption fixes the minimized regression and the previously failing indemnification corpus cell without modifying expected outcomes. Complete/multiple/nested cases and partial-field safety tests pass. Empty runs are separately measured and excluded only from formatting ownership, never from paragraph-removal decisions. The full corpus and fresh review remain required.

The required corpus run on September 14 failed the NVCA indemnification paragraph-deletion cell (and consequently its strategy-manifest characterization). The candidate retains bare field delimiters in the otherwise deleted Heading2 paragraph. Native Accept transfers Heading2 onto the following COMMENT paragraph, violating source formatting fidelity. The manifest was not changed.

Actual LibreOffice probes distinguish empty runs/empty text from fields: empty runs choose the following paragraph's formatting; bare field delimiters retain the leading format. A minimized case with deleted field instruction and result but unwrapped delimiters also retains the leading format on Accept. The new explicit regression expects the intended revised formatting and is RED. Therefore ignoring field delimiters merely to clear native fidelity would disagree with the reader. Task 1.4's evidence-conflict stop gate is active; field-aware emission needs adjudication before further repair or shipping.

Separately, the public Management Rights Letter production artifact passed strengthened reader comparison and both document/notes schema checks. Page 2 renders of original, revised, Accept and Reject were inspected: clause numbers and note order match their corresponding source states. This target-case success does not override the failing corpus gate or establish Word behavior.

## Manifest adjudication, September 15

The first extended-repair corpus run passed all publication safety, formatting, text, field, bookmark, relationship and minimality assertions, then failed the expected snapshot comparison. Five of 23 rows changed; source identities, text hashes, formatting scores and divergence approvals did not change. A separately executed control compared the serializer from pushed head a8c467c0 with the new serializer on identical constructed trees, confirming these causes:

| Row | Causal change |
|---|---|
| checked-in/ILPA | 21 fewer split deletion wrappers; 21 field controls remain deleted instead of live. Total field count is unchanged. |
| checked-in/p-unit-agreement-v2 | One synthetic pPrChange removed; deletion and field counts unchanged. |
| checked-in/paragraph-delete | One synthetic pPrChange removed; deletion and field counts unchanged. |
| real/nvca-indemnification-agreement/paragraph-deletion | Six fewer split deletion wrappers; six controls (two fields) remain deleted. Total field count unchanged. |
| real/nvca-management-rights-letter/paragraph-deletion | One synthetic pPrChange removed; deletion and field counts unchanged. |

The full-pipeline snapshot therefore changes document bytes/hashes for these five rows, accepted XML hashes in three, and deletion-range statistics in ILPA (802 to 781) and indemnification (8 to 2). This is a reviewed representation change, not an approval of text/format drift. The existing updater regenerates the manifest only after this causal audit; required corpus replay still must pass afterward. Local control code/output is retained under `.peer-review/manifest-causal.ts` and `causal-*.xml` and is public-fixture-only.
