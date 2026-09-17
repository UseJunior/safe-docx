# Paragraph merge formatting: evidence before policy

## Observed distinction

Moving a numbered paragraph may legitimately change its ordinal in the revised sequence. Accept must match the revised sequence; Reject must restore the original. An unnumbered restored heading is not ordinary renumbering.

Current native projection always retains the following paragraph's `w:pPr` when a tracked break disappears. The emitter compensates by cloning predecessor properties onto a wholly deleted paragraph and storing its original properties under `w:pPrChange`. This keeps native projection checks green but triggers the reader's paragraph-format rejection path.

Installed reader: LibreOffice 26.2.5.2, revision `cd7284b4cbbfeb507e630c1aac019f4157393acb`. Its `sw/source/core/doc/DocumentRedlineManager.cxx:986` removes numbering for paragraph-format rejection. The causal control removes only the source paragraph's synthetic property change and restores its original properties; both reader projections then pass the measured checks. This does not establish universal font/layout fidelity or Word behavior.

## Decision procedure

1. Minimize to two/three synthetic paragraphs. Cross Accept/Reject with first/second/both/no surviving content, same/different styles, direct/inherited numbering, explicit suppression, partial/whole revisions and consecutive removed breaks.
2. Check complete packages through the actual reader dispatches, not through pre-projected native DOCX files. Record paragraph count, text, note bindings, resolved style, alignment, indentation, outline and numbering state; inspect rendered numbers on the public regression.
3. Audit the cited ECMA-376 sections and available Word evidence separately. The cited paragraph-mark rule establishes removal of a delimiter; do not infer a universal formatting winner from delimiter removal alone.
4. Choose the narrowest supported merge rule. If the surviving-content pattern matters, capture it before mutation and test it explicitly. Do not introduce a heuristic that drops any paragraph merely because its content is gone.
5. Apply the proven rule consistently to core Accept/Reject and comparison projection, and simplify the emitter only where native and independent reader projections agree.

## Boundaries

Preserve tables, sections, range anchors, terminal-paragraph validity, historical property records and multi-author revision ownership. Characterize unresolved terminal cases separately (#891/#973). Existing note follow-ups (#979) are not silently included. The independent release verifier must stay independent and its formatting-blind structural check must not be represented as a formatting oracle.

## Rejected shortcuts

- More inherited `numId`/`ilvl` snapshots: tested, still missing the number on Reject.
- Removing the format revision without correcting/adjudicating native projection: reader checks pass, native Accept changes a BodyText paragraph into Heading1.
- Restoring the deletion mark on the removed paragraph: reader Accept produces 34 paragraphs instead of 33 on the public case.
- Hard-coding numbers as text or accepting the extra paragraph: changes document semantics or layout.

## Rollout

### Approved field-aware extension (September 15)

The corpus conflict is caused by emission, not by treating field delimiters as visible text. `hoistFieldCharactersFromDeletions` exempted exactly one begin/separate/end sequence; two complete fields in one deletion were hoisted into live runs. Actual-reader controls confirm that these surviving field objects retain leading formatting, whereas complete field deletion allows following formatting to survive. Replace the single-field exemption with a stack-validated complete sequence check (including multiple fields, nesting and optional separators). Partial field controls keep their existing handling. Never ignore surviving field controls in the formatting projector to conceal faulty emission.

Empty runs and empty text are a separate measured case: they do not own merged formatting. The formatting-only predicate may ignore them, but the paragraph-removal predicate is unchanged. Tables, sections, annotation ranges and unresolved revisions retain the existing conservative boundaries.

Keep the current PR blocked until scope is approved and evidence passes. Avoid forcing a broad shared-model change into the note repair merely to clear shipping. If the decision table requires a materially wider rule change than this proposal, return for approval with exact affected cases. No hosted API work is authorized.

### Approved section-mark blocker extension (September 17)

Opus 5 control D3 combines a schema-valid `pPrChange`, a live section and an inserted paragraph mark. Retaining the live section triggered the shared formatter's early return, after which mark resolution deleted the leading paragraph and its restored alignment. The original native path retained alignment only because it incorrectly discarded the section earlier. Owner approved repairing this blocker before shipping.

The bounded repair separates base-format selection from section-break selection: a section child cannot suppress the leading content's restored base formatting. The helper continues retaining the following surviving mark's section rather than copying section properties as base formatting. Explicit native expectations cover the merge; parity alone cannot validate shared code. Actual LibreOffice Reject retains restored `jc=both` on `FirstSecond`; its final page dimensions also follow the leading section. That latter observation is a separate section-layout characterization, not proof that the existing native section-selection policy matches LibreOffice or Word. Do not silently transplant section bindings or claim universal section fidelity to clear the alignment blocker.
