# Paragraph-merge decision evidence

## Normative audit

The vendored ECMA-376 edition 5 Part 1 artifact was extracted locally and the complete element descriptions and examples for sections 17.13.5.15 and 17.13.5.20 inspected (printed pages 846-847 and 857). They describe a tracked paragraph delimiter and the combination of adjacent paragraph content. These passages do not establish the previous universal following-paragraph formatting rule. The formatting choice below is an explicitly reader-characterized implementation policy, not a claim that the standard mandates a particular formatting winner. Word has not been verified.

Section 17.3.1.26 and the vendored CT_PPr sequence govern property ordering. The helper preserves that order, retains the surviving section, and preserves pending revision markers independently from the chosen paragraph-mark font formatting.

## Reader matrix

Measured on LibreOffice 26.2.5.2, revision `cd7284b4cbbfeb507e630c1aac019f4157393acb`, using actual AcceptAllTrackedChanges/RejectAllTrackedChanges dispatches. The first paragraph is right aligned, the second centered. Only the first paragraph's break is revised.

| Projection | First text survives | Second text survives | Formatting owner | Word evidence |
|---|---|---|---|---|
| Accept | no | no | second | UNVERIFIED |
| Accept | no | yes | second | UNVERIFIED |
| Accept | yes | no | first | UNVERIFIED |
| Accept | yes | yes | first | UNVERIFIED |
| Reject | no | no | first | UNVERIFIED |
| Reject | no | yes | second | UNVERIFIED |
| Reject | yes | no | first | UNVERIFIED |
| Reject | yes | yes | first | UNVERIFIED |

The full table was repeated with inherited numbering, direct numbering, and explicit numId=0 suppression. Each output was compared with an independently loaded clean control, including list participation and suppression flags. The plain matrix uses the same implicit paragraph style with different direct alignment; the numbered matrix uses distinct Alpha/Beta styles.

A further DOCX-export control gave the first paragraph a red, 20-point paragraph-mark font and the second a blue, 10-point mark. Both Accept and Reject retained the first mark's red/20-point properties when first content survived. These are committed as actual-reader regressions, not an unexecuted inference about run properties.

Initial native regression run: five of eight cases failed against the prior unconditional following-format rule; the independent plain reader matrix passed. After the initial repair, 133 focused tests passed. Added native cascading/partial-content and pending-revision/section-preservation regressions also passed. Final-head and exact-merge full-suite, corpus, review and shipping evidence completed September 16 and is separately recorded in tasks.md; that success is not backdated to an earlier failing commit.

## Public-document causal controls

Public NVCA Management Rights Letter, locally SHA-pinned to the repository manifest. Diagnostic copies and renders remain ignored/local. No private document was used.

- Existing synthetic pPrChange: Reject loses the paragraph number.
- Original properties with preceding deleted break: reader Accept and Reject match all 33 measured paragraph/heading entries; old native Accept assigns Heading1 to an unchanged BodyText predecessor.
- Original properties with conventional source break: reader Accept leaves an additional empty paragraph, 34 versus 33.
- Symmetric preceding boundaries for note-bearing deletion/insertion, original properties retained: reader Accept and Reject match all 33 measured entries without synthetic paragraph-format changes.

The reader comparison includes text, note binding, style, outline and numbering suppression/list-header flags. It is not by itself evidence of every font/layout property. Final rendered numbering inspection is required before shipping.

## Deliberate limits

The release verifier's independent projection returns paragraph text, not paragraph formatting; it remains unchanged and is not counted as a formatting voter. Break removal remains mark-based. Tables, annotation boundaries and sections retain conservative serializer guards. Word is UNVERIFIED. Unsupported reader behavior must be characterized, not hidden by accepting schema-only or text-only checks.

In particular, the measured second-owner rows are Accept/no/no, Accept/no/yes and Reject/no/yes (first/second surviving text). A reader that always retains leading formatting would diverge on those three rows, affecting paragraph style, outline and numbering, not merely alignment. No row in this table has been measured in Word; the leading-owner rows are not exempt from that limitation.

The shared merge helper retains the following paragraph's pending pPrChange/rPrChange when the chosen leading owner has no corresponding record. This is a helper-wide fallback, not a selective-only branch. Both native and comparison Reject resolve selected property history on the original paragraphs before merging; unresolved records remain in selective-author native projections and are preserved by the fallback. When both have a record, the leading owner's record has precedence; combining two independent property histories into one schema slot is not characterized here. This ordering is an implementation policy matching core projection semantics, not a claim that a normative source dictates phase order.

## Shipping hold: field-bearing paragraph conflict

**September 15 resolution:** owner approved the field-aware extension. A control deleting complete field boundaries together with their code/result retains the following paragraph format in LibreOffice; the previous unwrapped-boundary shape retains the leading format. The serializer had exempted only exactly one begin/separate/end sequence from hoisting. Two complete fields were therefore left alive. A stack-validated complete sequence exemption fixes the minimized regression and the previously failing indemnification corpus cell without modifying expected outcomes. Complete/multiple/nested cases and partial-field safety tests pass. Empty runs are separately measured and excluded only from formatting ownership, never from paragraph-removal decisions. The full corpus and fresh review remain required.

The required corpus run on September 14 failed the NVCA indemnification paragraph-deletion cell (and consequently its strategy-manifest characterization). The candidate retains bare field delimiters in the otherwise deleted Heading2 paragraph. Native Accept transfers Heading2 onto the following COMMENT paragraph, violating source formatting fidelity. The manifest was not changed.

Historical red evidence: actual LibreOffice probes distinguish empty runs/empty text from fields: empty runs choose the following paragraph's formatting; bare field delimiters retain the leading format. A minimized case with deleted field instruction and result but unwrapped delimiters also retains the leading format on Accept. The initial regression expecting intended revised formatting was RED. Ignoring field delimiters merely to clear native fidelity would disagree with the reader. This evidence-conflict stop gate was resolved by the owner-approved September 15 field-emission repair above, not by relaxing the projector or suppressing the red evidence.

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

## Completed PR #980 delivery, September 16

Fresh dynamic Opus 5 approved exact final head `25ff4870309706813a348559690cbbd095f09117` after actual 160-test reader/parity execution and 27 additional parity probes. All six local gates and required public corpus 21/21 passed. PR #980 merged at `615fd5f7abf0d4f9b20a54b4f811e0374754b483`; its tree matched the reviewed head. A fresh detached exact-merge worktree, independent locked dependencies and clean build passed the complete suite (3,412 passed/47 documented skips), required-reader suite and built-code public NVCA smoke. Native/package note projections, topology, relationships and main-document/footnote XSD checks passed. Actual-reader Accept/Reject each matched 33/33 measured entries of their independent source states. Fresh page-2 renders were inspected and opened locally: Accept has revised order/ordinals and Reject restores original numbered clauses and notes. This is measured target-case numbering evidence, not complete font/layout or Word evidence.

Production docs reached READY with that exact merge SHA; no hosted API was built or deployed. Public proof: https://github.com/UseJunior/safe-docx/pull/980#issuecomment-5701007298 . Original failing logs and complete reviews remain preserved locally under `/private/tmp/safe-docx-980-evidence-20260916/`.

## Separate follow-ups and bounded September 17 extension

- #984 was separately repaired and shipped as PR #988, merge `ca61878023cda735333a551264a4a89470b035d5`. The approved D3 section/mark repair restores native `jc=both` on merged `FirstSecond` while keeping section-break selection separate from base formatting. Actual LibreOffice Reject also retains that alignment, but uses leading page dimensions (~10000x14000), whereas the native section policy retains following dimensions (12240x15840). This archive does not certify that section policy or transplant section bindings. Exact-merge public ILPA property restoration, clean full-suite and schema smoke passed; proof: https://github.com/UseJunior/safe-docx/pull/988#issuecomment-5719983274 .
- #979 aligned inline-note history/reader bindings, #982 vacated paragraph-mark cleanup and #985 native move-mark projection are separate focused runtime follow-ups. Their individual reviewed heads, CI and exact-merge receipts determine completion; PR #980's approval is not substituted for those gates.
- #973 terminal-move range/paragraph ownership remains unresolved. Ordinary insertion/deletion companion-marker experiments fail selective move-only semantics; real-move-marker experiments still leave the actual-reader terminal empty paragraph. A materially wider public revision-selection/structure change requires renewed owner approval, not implicit approval through this archive.
- #983 public cross-reference cache versus evaluated numbering remains a separate characterization: clean baseline and current comparison reproduce dotted `Section1.(a)` on Reject, while explicit field refresh of an unchanged original reproduces the same punctuation. No cache normalization, field locking or hard-coded number is justified by that evidence alone; Word remains unverified.
- Newly discovered inherited limits remain separate: #987 snapshot-less section-history/header bindings, #990 property-changing note-anchor history, #991 selective foreign paragraph-mark history loss, and #992 content-dependent reachability validation. None is silently resolved or covered by this archive.

## Archive traceability gate, September 17

Before canonical promotion, all five comparison scenarios were enforced by the coverage validator (70/70). The numbered reader control now inspects `styles.xml` from the same saved output package: linked document-outline decimal rule/start, heading order/ordinals, restart metadata, numbering suppression and list-header state. It also directly measures native source-projected formatting. Evidence capture gets an isolated buffer copy; an actual-reader test mutates that copy and confirms the returned reader XML is unchanged. Four unfiltered Reject native/AST property-history parity assertions are mapped separately from selective-author tests.

The release-readiness negative test first measures actual unresolved reader Accept/Reject agreement, repository XSD success and text expectations, then explicitly injects a failing native formatting vote through the internal test seam. The publisher must reject with only `formattingFidelity` failed, both with format-change detection on and off. This tests that reader/text/schema success cannot bypass a native failure; it does not claim this fixture has a real current native disagreement or turn the text-only release verifier into a formatting oracle. Required mapping/reader suite passed 56/56; tightened linked-outline and capture-isolation control passed subsequently. Archive strict validation and this docs/test-only follow-up's own final-head review/CI/smoke must still complete independently.
