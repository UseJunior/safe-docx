# Change: Make Accept All paragraph removal purely mark-based (closes G5, oracle-validated)

## Why

The Lean↔TS helper differential (`add-lean-ts-helper-differential-harness`) pinned **G5**: accepting a
paragraph whose only content is inside `w:del` (with an **untracked** paragraph mark) — the Lean `accept`
keeps an empty `<w:p>`, the TS `acceptAllChanges` drops the whole paragraph. G5 is the exact accept-side
mirror of **G4** (closed by `make-reject-paragraph-collapse-mark-based`): an **engine over-deletion**, not a
Lean-model gap.

- **LibreOffice / Word / OOXML semantics:** `<w:del>` inside `<w:pPr><w:rPr>` (PPR-DEL) marks the paragraph
  **mark** as deleted. A run-level deletion under an *untracked* mark means text was deleted from a
  **pre-existing** paragraph, so accepting the deletion restores that (empty) paragraph. Only when the mark
  itself is `PPR-DEL` should accept remove the whole paragraph. LibreOffice (driven headless) keeps the empty
  paragraph for `del`-only and `moveFrom`-only untracked-mark cases, and drops the `PPR-DEL`-marked control —
  the same shape already confirmed for the reject side in `make-reject-paragraph-collapse-mark-based`.
- The Lean `accept`, broadened by `broaden-lean-accept-keep-empty-paragraphs` (G3, #340) to never drop, was
  already faithful — it keeps the empty paragraph. G5 is the TS engine catching up to it.

The engine drops G5 via a content-based heuristic ("all content is inside `w:del`/`w:moveFrom`") on **both**
accept paths. `wrapParagraphAsDeleted` already always emits `PPR-DEL`, so making accept purely **mark-based**
(drop iff the paragraph mark is `PPR-DEL`) is Word/LibreOffice-faithful, keeps safe-docx's own delete→accept
round-trip safe, and closes G5 by fixing the engine — exactly symmetric to the #337 reject fix.

## What Changes

- `acceptAllChanges` (`packages/docx-core/src/baselines/atomizer/trackChangesAcceptorAst.ts`) and the
  primitive `acceptChanges` (`packages/docx-core/src/primitives/accept_changes.ts`,
  `paragraphHasOnlyRemovedContent`) SHALL remove a paragraph on accept **iff its paragraph mark is `PPR-DEL`**
  — the content-based all-`w:del`/`w:moveFrom` drop heuristic is removed from **both** accept paths in
  lockstep (they are used by different public APIs and SHALL agree).
- Flip the G5 case in `lean-differential-helpers.test.ts` (`[LEAN-HELP-08]`) from *characterized divergence*
  to *agreement*; update the file header (G5 closed, no KNOWN gap remains). Add a targeted regression test
  exercising **both** accept entry points on the four shape classes (PPR-DEL drop, del-only keep, moveFrom-only
  keep, pPrChange-snapshot ignore), asserting the two paths agree.

## Impact

- Affected specs: `docx-comparison` (ADDED: one requirement; the pending helper-differential change's G5
  scenario and the pending Lean-broaden change's G5 scenario are revised in place to agreement since neither
  is archived).
- Affected code: `packages/docx-core/src/baselines/atomizer/trackChangesAcceptorAst.ts`,
  `packages/docx-core/src/primitives/accept_changes.ts`, and tests
  (`trackChangesAcceptorAst.test.ts`, `integration/lean-differential-helpers.test.ts`).
- **Behavior change** (accept of foreign / mark-omitting documents): a paragraph whose runs are deleted
  under an untracked mark now survives accept as an empty paragraph instead of being dropped — matching
  Word/LibreOffice. safe-docx's own deleted paragraphs always carry `PPR-DEL`, so their delete→accept
  round-trip is unchanged (validated: full docx-core suite 1347 passed / 3 skipped, no regression).
- With G5 closed, every characterized G-case (G1–G5) of the Lean↔TS helper differential agrees; no KNOWN gap
  remains in that harness.
