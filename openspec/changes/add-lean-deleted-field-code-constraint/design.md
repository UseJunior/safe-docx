## Context

`Tier2.FieldStructure.validateFieldStructure` mirrors two of the three checks in the production
`validateFieldStructure` (`pipeline.ts:352-402`): (1) global `fldChar` begin/end balance and (2) every
`instrText`/`delInstrText` inside an open pre-`separate` field body. It omits constraint (3), the
`DeletedFieldCode` locality rule (`pipeline.ts:427-428`, enforced at `pipeline.ts:474`):

- `w:fldChar` MUST NOT appear inside a `w:del` ancestor (G1), and
- `w:delInstrText` MUST appear only inside a `w:del` ancestor (G2).

The engine's canonical enforcement is the main `validateFieldStructure` scan
(`pipeline.ts:525-560`): `fldChar` at `insideDelDepth > 0` returns `false` (`pipeline.ts:542`, all
`fldCharType`s) and `delInstrText` at `insideDelDepth === 0` returns `false` (`pipeline.ts:555`), after
which the open-pre-`separate` check still applies. (A second, redundant `fldChar`-only helper scan lives at
`pipeline.ts:458-474`.) The global begin/end balance loop (`pipeline.ts:503-511`) counts `fldChar`s
**ignoring** `insideDelDepth`, which the Lean `fldCharBalanced` already mirrors with an ungated structural
count — so constraint (1) is unaffected.

The current Lean walk (`FieldStructure.lean:82-90`) treats `del` as transparent and carries no
del-ancestry, so it returns `true` on both shapes the engine rejects.

## Goals / Non-Goals

- Goal: enforce constraint (3) in the Lean walk so `validateFieldStructure` agrees with the engine on
  G1/G2, closing both characterization gaps. Keep the spike zero-`sorry`.
- Non-Goal: G3/G4 (accept/reject paragraph-mark collapse). They need a `PPr`/`Paragraph` datatype
  extension and are a separate slice (4b).
- Non-Goal: any production-engine change.

## Decisions

- **Decision: carry del-ancestry as an explicit structural `delDepth : Nat` parameter on the walk, not
  as new state inside `WalkResult`.** The field context (`FieldCtx = List Bool`) flows *linearly* through
  document order and accumulates across siblings, so it lives in `WalkResult`. Del-ancestry is *purely
  structural*: it is fixed by lexical nesting and is restored on leaving a `del` subtree. Modeling it as a
  parameter — `walkBlocks (delDepth : Nat) : WalkResult → List Block → WalkResult`, incremented only in
  the `.del bs` recursion — keeps `WalkResult` (and its `DecidableEq`/`Repr`) untouched, which minimizes
  churn in the downstream proofs that pattern-match on `WalkResult`.
- **Decision: gate only `fldChar` and `delInstrText` on `delDepth`.** Constraint (3) says nothing about
  `instrText`/`delText` inside `del`; leaving them ungated keeps the model faithful to `pipeline.ts:542`/`555`
  (which special-case exactly `w:fldChar` and `w:delInstrText`) and to the open-field check already covering
  `instrText`. All `fldCharType`s are gated, matching the engine's untyped `tag === 'w:fldChar'` test.
- **Decision: field-context and del-depth are orthogonal.** The faithful-subset legal case opens a field
  at top level (`fc_begin`), nests a `del`-wrapped `delInstrText` while the field is open and
  pre-`separate`, then `fc_sep` at top level — i.e. the field context crosses the `del` boundary. The
  del-depth parameter does not touch `FieldCtx`, so this case keeps validating.

## Proof-repair plan (corrected after peer review — NOT just signature plumbing)

Both dynamic reviewers (Codex + agy, each built the spike green and read the proof files) refuted the
original "signature-plumbing only" claim. Adding constraint (3) makes the per-step rename-safety lemma
**false as stated**, because the `reject` rename `delInstrText → instrText` is no longer walk-invariant at
`delDepth = 0`: `stepAtom 0 r (.delInstrText s)` is now `invalid` while `stepAtom 0 r (.instrText s)` stays
valid in an open field. Concretely:

- **`InvFieldOne.lean:130` `stepAtom_renameAtom`** (`stepAtom r (renameAtom a) = stepAtom r a`) becomes
  false at `a = .delInstrText s`, `delDepth = 0`.
- Cascades to **`stepAtoms_renameAtom`** (`:139`), **`walkBlocks_renameBlocks`** (`:147`),
  **`walkBlocks_acceptBlocks`** (`:215`), **`walkBlocks_rejectBlocks`** (`:251`) — `rejectBlocks` unwraps
  `del` so a former depth-1 `delInstrText` is walked at depth 0 *before* the global rename runs — and the
  **legacy `field_structure_preserved`** (`:395-421`) that consumes them.

**Split the two proof paths (the headline survives; the legacy lemma is retired):**

- **Headline `field_structure_preserved_doc` (`:439`) — KEEP, plumbing only.** It consumes
  `preservationFriendly` (the *composed*, document-level walk/balance equalities), not the per-step
  lemmas. Update `preservationFriendly` (`AcceptReject.lean:105`) and `validateFieldStructure` to walk at
  `walkBlocks 0`; the proof stays as-is. This is the theorem that actually closes `inv_field_001` (with the
  residual axiom `compareDocumentXml_output_preservation_friendly`), per the comment at
  `InvFieldOne.lean:423-438`.
- **Legacy `field_structure_preserved` (`:395`) + the four standalone lemmas — RETIRE (delete).** The
  in-code comment already marks it non-load-bearing, "retained for audit traceability," superseded by the
  doc-level theorem. Constraint (3) makes its `recursivelyWellformed` precondition (which demands `∀ ctx`
  neutrality of *every* wrapper subtree) **unsatisfiable for any document containing a legal
  `delInstrText`-in-`del`** — a `del` child subtree `[run [delInstrText]]` is `invalid` at `delDepth 0`, so
  non-neutral. Re-proving it would need a del-depth- *and* wrapper-tag-aware neutrality predicate
  (`wrapperSubtreesBlocks` currently discards the tag) for an audit-only lemma whose precondition no longer
  admits the interesting documents. Not worth the proof surface; delete it and its now-false supporting
  lemmas, and update the docs (`README.md:49`, `ROADMAP.md:98`, `Tier2/README.md`) to name
  `field_structure_preserved_doc` as the sole headline preservation theorem.

`RoundTripText.lean` does **not** reference `walkBlocks` (verified by both reviewers) — no repair there.

## Risks / Trade-offs

- **Retiring a named theorem** narrows the published claim surface (a *stronger-but-non-load-bearing*
  lemma is removed). Mitigation: it is explicitly audit-only today and its precondition becomes vacuous for
  the documents constraint (3) is about; `inv_field_001` is unaffected (it rides the doc-level theorem). The
  alternative — keep it via a tag-aware neutrality predicate — is real new mathematics for zero gain to the
  headline result.
- **Performance**: walk stays linear; one extra `Nat` parameter. Negligible.

## Migration Plan

Single PR (slice 4a). No data migration. Zero-`sorry` is the gating invariant (the retired lemmas are
deleted, never `sorry`-stubbed); verify with the CI grep and the full helper + LCS differentials before
shipping.

## Open Questions

- None blocking. The `fieldContextNeutral` generalization question is resolved by retiring the legacy path
  rather than strengthening the predicate. If a future #217 engine-conformance increment wants the stronger
  lemma back, it would introduce the tag-aware neutrality predicate then.
