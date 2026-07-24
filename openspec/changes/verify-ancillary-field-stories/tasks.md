## 1. Specification and conformance

- [x] 1.1 Update the ECMA-376 registry and non-goals with only the registered header/footer binding/root and field structure/instruction claims.
- [x] 1.2 Label target normalization, package containment, note-entry isolation, duplicate direct note-ID rejection, provenance, and exact canonical preservation as SafeDocX policies or invariants.
- [x] 1.3 Add source JSDoc and structured test citations only where the implementation exercises the cited clause; use §17.11.14 only for actual reference-ID semantics.
- [x] 1.4 Keep the Lean predicate, executable protocol v3, inplace-only mode, and fixed main/footnotes/endnotes scope unchanged.

## 2. Binding selection and strict stories

- [x] 2.1 Reuse `sectPrAudit` binding resolution and a shared robust OPC target normalizer for direct section-property bindings, valid roles, per-section role uniqueness, unambiguous relationship IDs, exact relationship types, exact target modes, safe internal targets, and expected roots.
- [x] 2.2 Return binding locators with section ordinal, kind, and role; deduplicate target validation by normalized path while retaining every selecting binding.
- [x] 2.3 Add a strict ancillary field-story predicate separate from `validateFieldStructure`.
- [x] 2.4 Reject stray end, stray depth-zero separator, duplicate same-depth separator, unknown/missing `fldCharType`, and unclosed depth while accepting begin/end-only and properly stacked nested fields.
- [x] 2.5 Extract every final footnote/endnote entry, including reserved entries, as an independent strict story.
- [x] 2.6 Canonicalize note IDs as `xsd:integer`; reject invalid lexical IDs and numeric-equivalent duplicate direct IDs in base/final contributors and only actually contributing merge-source parts before provenance or evidence mapping.
- [x] 2.7 Ensure unreferenced header/footer files are never globbed or admitted to the selected story set.

## 3. Provenance and preservation inventory

- [x] 3.1 Capture entry provenance from the post-collision in-memory base and merge-source archives used by assembly.
- [x] 3.2 Record base wins, imported IDs, newly created note-part entries, copied reserved entries, same-ID identical definitions, and collision-renumbered IDs deterministically.
- [x] 3.3 Extract and reuse PR #617 supported-instruction parsing and expanded-name canonical subtree logic.
- [x] 3.4 Enumerate eligible source fields first in depth-first order with part, entry, paragraph, eligible-field, and instruction locators.
- [x] 3.5 Compare independent final inventories by structural locator excluding instruction kind and by canonical range; reject missing, extra, relocated, reclassified, or mismatched ranges with reachable diagnostics.
- [x] 3.6 Exclude nested and cross-paragraph ranges from preservation inventory while retaining whole-story strict validation.

## 4. Failure contract

- [x] 4.1 Add `AncillaryStorySafetyError` with binding-resolution, strict-field-structure, and canonical-evidence categories plus structured locators, issue codes, and details.
- [x] 4.2 Run the ancillary gate after complete mode-specific assembly and reject a failing inplace candidate.
- [x] 4.3 Attempt exactly one rebuilt assembly after ancillary inplace rejection and recompute selection, validation, provenance, and evidence.
- [x] 4.4 Throw before returning or publishing output when direct/forced rebuild or terminal fallback fails; never return warning-only success or public evidence on failure.
- [x] 4.5 Leave ancillary revision synthesis, text comparison, field evaluation, pagination, bookmark resolution, and complete note integrity unchanged.
- [x] 4.6 Add optional passed-only `CompareResult.ancillaryFieldEvidence` with final mode, binding/story summaries, and provenance-bearing canonical range items.
- [x] 4.7 Extend fallback reason with `ancillary_story_safety_check_failed` and add optional rejected-candidate `ancillaryFallbackDiagnostics`.

## 5. Evidence coverage

- [x] 5.1 Extend shared OOXML/DOCX fixtures for valid section bindings, malformed unreferenced parts, independent note entries, created parts, imports, identical IDs, and collision renumbering.
- [x] 5.2 Add strict-predicate tests that pin its differences from Lean-pinned `validateFieldStructure`, including stray depth-zero separator rejection and valid begin/end-only and nested fields.
- [x] 5.3 Add forced-rebuild and true-inplace tests for source-first inventories and exact canonical evidence.
- [x] 5.4 Add a test where ancillary failure itself rejects inplace, one rebuilt assembly succeeds, and stale candidate evidence is discarded.
- [x] 5.5 Add terminal direct-rebuild and fallback error tests for all failure categories and structured diagnostics.
- [x] 5.6 Add adversarial binding target/mode/placement, reachable inventory-code, repeated-field, nested/cross-paragraph exclusion, and unreferenced-malformed-part tests.
- [x] 5.7 Cover invalid and numeric-equivalent note IDs, unused malformed merge-source parts, base wins, imported definitions, new-part reserved provenance, same-ID identical definitions, and post-collision renumbered IDs.
- [x] 5.8 Preserve the existing NVCA source-vs-filled large-diff regression, then derive a minimally edited revised copy from `nvca-coi-regression/source.docx` with exported `replaceParagraphTextRange`; require true inplace and forced rebuild runs with nonzero selected-footer PAGE and footnote REF evidence.
- [x] 5.9 Assert successful evidence reports final mode, fallback diagnostics retain only rejected-candidate issues, and terminal errors return no result.
- [x] 5.10 Assert Lean remains protocol v3, inplace-only, fixed to main/footnotes/endnotes, with headers/footers excluded.

## 6. Verification

- [x] 6.1 Run focused comparison, package-assembly, conformance, and NVCA COI tests.
- [x] 6.2 Run build, workspace lint, strict OpenSpec validation, spec coverage, and conformance checks.
- [x] 6.3 Run the mandatory repository pre-submit suite and review the final diff.
