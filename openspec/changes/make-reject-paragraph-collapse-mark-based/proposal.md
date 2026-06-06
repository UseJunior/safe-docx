# Change: Make Reject All paragraph removal purely mark-based (closes G4, oracle-validated)

## Why

The Lean↔TS helper differential (`add-lean-ts-helper-differential-harness`) pinned **G4**: rejecting a
paragraph whose only content is inside `w:ins` (with an **untracked** paragraph mark) — the Lean `reject`
keeps an empty `<w:p>`, the TS `rejectAllChanges` drops the whole paragraph. The original framing assumed
G4 was a Lean-model gap. A reference-implementation oracle shows the opposite: **G4 is an engine
over-deletion.**

- **LibreOffice** (driven headless, accept/reject all): an `ins`-run under an untracked paragraph mark
  rejects to an **empty paragraph that survives** (the run-level insertion redline deletes only the text;
  the paragraph node is never in the redline range). Confirmed for `ins`-only (keeps), `moveTo`-only
  (keeps), and the `PPR-INS`-marked control (drops). The same is true on the accept side for `del`-only.
- **OOXML semantics:** `<w:ins>` inside `<w:pPr><w:rPr>` (PPR-INS) marks the paragraph **mark** as
  inserted. A run-level insertion under an *untracked* mark means text was inserted into a **pre-existing**
  paragraph, so rejecting restores that (empty) paragraph. Only when the mark itself is `PPR-INS` should
  reject remove the whole paragraph.
- **Google Docs:** renders inserted runs identically with or without `PPR-INS`, and rejecting a
  `PPR-INS`-marked inserted paragraph removes it cleanly with **no leftover empty paragraph** — i.e.
  `PPR-INS` is strictly better there, debunking the (uncited) "Google Docs hides w:ins runs with PPR-INS"
  rationale the engine relied on.

The engine drops G4 via a content-based heuristic ("all content is inside `w:ins`/`w:moveTo`") that exists
only to compensate for `wrapParagraphAsInserted` **omitting** `PPR-INS` for non-empty inserted paragraphs.
That heuristic over-deletes foreign (Word/LibreOffice-authored) paragraphs whose mark is untracked. Making
insertions always carry `PPR-INS` lets reject be purely **mark-based** — Word/LibreOffice/Google-Docs
faithful — and closes G4 by fixing the engine, with the Lean model (keep-empty) already correct.

## What Changes

- `wrapParagraphAsInserted` (`packages/docx-core/src/baselines/atomizer/inPlaceModifier-wrappers.ts`)
  SHALL **always** emit the `PPR-INS` paragraph-mark marker, including for non-empty paragraphs (drop the
  prior "Google Docs compat" omission). `wrapParagraphAsDeleted` already always emits `PPR-DEL`.
- `rejectAllChanges` (`trackChangesAcceptorAst.ts:533-579`) and the primitive `rejectChanges`
  (`primitives/reject_changes.ts`, `paragraphHasOnlyInsertedContent`) SHALL remove a paragraph on reject
  **iff its paragraph mark is `PPR-INS`** — the content-based all-`w:ins`/`w:moveTo` drop heuristic is
  removed from **both** reject paths in lockstep (they are used by different public APIs).
- Flip the G4 case in `lean-differential-helpers.test.ts` (`[LEAN-HELP-06]`) from *characterized
  divergence* to *agreement*; reverse the `inPlaceModifier.test.ts` "no-op for substantive runs" assertion
  to expect the marker; update the pending `add-lean-ts-helper-differential-harness` G4 scenario to match.

## Impact

- Affected specs: `docx-comparison` (ADDED: one requirement; the pending helper-differential change's G4
  scenario is revised in place since that change is not yet archived).
- Affected code: `packages/docx-core/src/baselines/atomizer/inPlaceModifier-wrappers.ts`,
  `packages/docx-core/src/baselines/atomizer/trackChangesAcceptorAst.ts`,
  `packages/docx-core/src/primitives/reject_changes.ts`, and tests
  (`inPlaceModifier.test.ts`, `integration/lean-differential-helpers.test.ts`).
- **Behavior change** (reject of foreign / mark-omitting documents): a paragraph whose runs are inserted
  under an untracked mark now survives reject as an empty paragraph instead of being dropped — matching
  Word/LibreOffice. safe-docx's own inserted paragraphs always carry `PPR-INS` now, so their insert→reject
  round-trip is unchanged (validated: full docx-core suite + round-trip-inplace 11/11 green).
- The Lean accept-side gap **G3** is unaffected and remains the next increment (broaden Lean `accept`).