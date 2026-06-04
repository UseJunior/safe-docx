# Design: Lean↔TS Tier 2-helper differential harness

## Context

Second Tier 2.5 increment. Mirrors the structure of `add-lean-ts-lcs-differential-harness` (a Lean executable reading batched JSON over stdin, a TS vitest harness spawning it once per chunk and asserting equality) but for the accept/reject/validate surface, which — unlike the LCS — needs a `Doc`→`document.xml` adapter and a non-trivial output comparison.

## Decision 1 — differential execution of the genuine Lean `def`s, same as LCS

The Lean executable links the **proved** Tier 2 modules and calls `Tier2.FieldStructure.validateFieldStructure`, `Tier2.AcceptReject.accept`, `Tier2.AcceptReject.reject` directly — never a re-implementation. Local `FromJson`/`ToJson` instances for `OoxmlModel.Atom`/`Run`/`Block`/`Paragraph` live in `DifferentialHelpers.lean` so the proved modules stay untouched (same pattern as `Differential.lean`'s local `Atom` instances).

JSON import: `import Lean.Data.Json` + `open Lean` (the form verified working in the LCS increment — it brings `Json.parse`, the deriving handlers, and the typeclasses into scope; `import Lean` / `import Lean.Data.Json.FromToJson` do not).

## Decision 2 — wire protocol (`Doc` as a tagged-union JSON tree)

`Tier2.OoxmlModel.Doc = List Paragraph`. The opaque `PPr`/`RPr` markers carry no cross-boundary meaning (the engine has no equivalent), so they are fixed to their defaults and not encoded. The wire `Doc` is a JSON array of paragraphs:

```
Doc       := [ Paragraph ]
Paragraph := { "body": [ Block ] }
Block     := { "run":      { "content": [ Atom ] } }
           | { "ins":      [ Block ] }
           | { "del":      [ Block ] }
           | { "moveFrom": [ Block ] }
           | { "moveTo":   [ Block ] }
           | { "other":    { "tag": String, "children": [ Block ] } }
Atom      := { "text": String } | { "delText": String }
           | { "instrText": String } | { "delInstrText": String }
           | { "fldChar": "begin" | "separate" | "end" }
```

Stdin: `{ "cases": [ { "doc": Doc } ] }`. Stdout: `{ "results": [ { "validate": Bool, "accept": Doc, "reject": Doc } ] }`. The single-tag-object encoding is unambiguous and round-trips through hand-written `FromJson`/`ToJson` instances (Lean's auto-derivation for recursive inductives with a structure field is finicky; explicit instances are clearer and matched to the wire grammar above).

## Decision 3 — the `Doc`→`document.xml` adapter (`renderDocToXml`)

The TS harness renders the same abstract `Doc` to OOXML the engine can parse via its `@xmldom/xmldom` path (`parseDocumentXml`):

```
Doc        → <w:document xmlns:w="…"><w:body>{paragraphs}</w:body></w:document>
Paragraph  → <w:p>{blocks}</w:p>
Block.run  → <w:r>{atoms}</w:r>
Block.ins  → <w:ins w:id="N" w:author="t" w:date="2020-01-01T00:00:00Z">{children}</w:ins>
Block.del  → <w:del w:id="N" …>{children}</w:del>           (moveFrom/moveTo analogous)
Block.other→ <{tag}>{children}</{tag}>     (tag ∈ a transparent-container allowlist)
Atom.text          s → <w:t xml:space="preserve">{esc s}</w:t>   (wrapped in its run)
Atom.delText       s → <w:delText xml:space="preserve">{esc s}</w:delText>
Atom.instrText     s → <w:instrText xml:space="preserve">{esc s}</w:instrText>
Atom.delInstrText  s → <w:delInstrText xml:space="preserve">{esc s}</w:delInstrText>
Atom.fldChar       k → <w:fldChar w:fldCharType="begin|separate|end"/>
```

Wrapper attributes (`w:id`/`w:author`/`w:date`) are present for OOXML faithfulness; the engine's accept/reject keys off tag names (`unwrapAllByTagName('w:ins')`, etc.) and the validator ignores them, so their exact values do not affect the comparison. `other` tags are drawn from an allowlist of containers the engine descends through transparently (e.g. `w:hyperlink`, `w:sdtContent`), matching the Lean `other` semantics. Strings are generated over a tiny alphabet with no XML metacharacters, but `renderDocToXml` still entity-escapes defensively.

## Decision 4 — comparison on a canonical token projection

Lean `accept`/`reject` return a `Doc`; TS `acceptAllChanges`/`rejectAllChanges` return an XML string. Rather than string-compare (serializer-format-fragile) or build an inverse XML→Doc parser tied to wrapper attributes, both outputs reduce to one **canonical token stream**:

- `docToTokens(doc: WireDoc): string[]` — flatten the Lean output `Doc` in document order: `P[` … `]` per paragraph, `R[` … `]` per run, wrapper tokens `INS[`/`DEL[`/`MOVEFROM[`/`MOVETO[`/`OTHER:tag[` … `]`, atom tokens `t:s` / `dt:s` / `it:s` / `dit:s` / `fc:begin|separate|end`.
- `xmlToTokens(xml: string): string[]` — parse the TS output via `@xmldom/xmldom` and walk `w:p`/`w:r`/`w:ins`/…/`w:t`/`w:fldChar` producing the **same** grammar.

`validate` is a plain `Bool` and compared directly. The two token streams are compared with structural deep-equality. The projection is total and order-preserving, so equal token streams ⇔ the two engines produced the same paragraph/run/wrapper/atom structure (modulo the opaque markers and wrapper attributes the model deliberately abstracts).

## Decision 5 — the faithful subset and the characterization cases

The default property generates `Doc`s **inside the subset where Lean and TS provably agree**, enforced by the arbitrary:

1. **`fldChar` and `instrText` appear only in top-level runs, never inside any `ins`/`del`/`moveFrom`/`moveTo` wrapper** — avoids G1 (`fldChar` in `del` → TS-only invalid).
2. **`delInstrText` is generated only in its one OOXML-legal home — inside a `del` wrapper, in an open pre-`separate` field** (via a dedicated field fragment). Both engines agree there (Lean walks transparently through `del`; TS requires exactly insideDel + open-field). This is the in-subset counterpart of the G2 characterization, which puts `delInstrText` *outside* `del` and diverges. `delInstrText` is otherwise excluded from random generation, so generated docs never straddle the G2 boundary.
3. **Every paragraph retains surviving top-level content** — at least one top-level `run` with ≥1 non-deleted atom — so neither an accepted body (avoids G3) nor a rejected body of an `ins`-only paragraph (avoids G4) is ever empty-but-was-wrappered. The two engines' paragraph-collapse rules differ on BOTH operations (TS `acceptAllChanges` keeps `ins`-wrappered collapsing paragraphs; TS `rejectAllChanges` drops `ins`-only paragraphs; Lean `accept` drops only truly-empty bodies and Lean `reject` never drops), so the survivor run is what keeps both out of the random subset.

Four explicit **characterization cases** assert the known divergences directly (fixed inputs, not generated), so each gap is a passing test that pins the limitation:

- **[G1]** a `Doc` with `fldChar` inside `del`: Lean `validate = true`, TS `validateFieldStructure = false`.
- **[G2]** a `Doc` with `delInstrText` in an open pre-`separate` field outside `del`: Lean `true`, TS `false`.
- **[G3]** a `Doc` with a paragraph whose only content is an `ins` wrapping deleted/empty content: Lean `accept` drops the paragraph, TS keeps an empty `<w:p>` — asserted via the token projection.
- **[G4]** a `Doc` with an `ins`-only paragraph (no surviving content): Lean `reject` keeps an empty `<w:p>` (its reject never drops paragraphs), TS `rejectAllChanges` removes it — the reject-side analog of G3, asserted via the token projection.

If a future proof increment teaches the Lean model constraint (3) and the engine's accept/reject paragraph-collapse rules, these characterization cases are where the change shows up: they flip from asserting divergence to asserting agreement, and the corresponding subset restriction is lifted.

## Decision 6 — negative control

A self-test perturbs one side of one helper (e.g. swaps `accept` and `reject` outputs, or flips a `validate` bool) and confirms the gate fails with a per-case diff — proving the equality assertions are load-bearing, mirroring `[LEAN-DIFF-04]`.

## Rejected alternatives

- **Inverse XML→`Doc` parser for comparison.** More code, and couples the comparison to wrapper-attribute serialization; the token projection is simpler and attribute-agnostic.
- **String-compare the rendered Lean output against the TS XML.** Brittle: depends on `@xmldom/xmldom` serializer whitespace/attribute-ordering and on re-deriving the engine's exact emit shape in Lean.
- **Generate broadly and assert a weaker invariant.** Hides G1/G2/G3 instead of pinning them; violates the asymmetry-of-rot principle that limitations must over-disclose. The subset-plus-characterization split keeps the gate strict while making every known gap a visible, tested fact.
- **Extend the Lean model to close G1/G2/G3 now.** Touches the `inv_field_001` proof; out of scope for a differential increment. Deferred to a proof increment, for which this harness is the worklist and regression guard.
