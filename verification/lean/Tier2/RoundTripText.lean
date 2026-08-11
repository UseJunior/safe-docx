/-
Tier 2 — round-trip text model and the `inv_rt_001` closure content.

Definitional mirror of the text-extraction half of
`packages/docx-core/src/baselines/atomizer/trackChangesAcceptorAst.ts`:

  * `extractText` mirrors `extractTextWithParagraphs` (`trackChangesAcceptorAst.ts:660-688`):
    one entry per `w:p`, the concatenation of `w:t` (`Atom.text`) and `w:delText`
    (`Atom.delText`) payloads found anywhere in the paragraph (descending through
    every wrapper and transparent container). `instrText` / `delInstrText` /
    `fldChar` contribute no text.

    NOTE — ordering gap (Tier 2.5): the TS helper collects *all* `w:t` first
    (`:669-675`) and *then* all `w:delText` (`:677-683`); this Lean model instead
    concatenates in structural document order, so for a paragraph that interleaves
    `text` and `delText` the two disagree. This is an extensional-equivalence gap
    owned by Tier 2.5, NOT a soundness issue for `inv_rt_001` (which is a theorem
    about this Lean model). It is also vacuous on every surface the round-trip
    actually compares — `accept` output, `reject` output (post `delText → text`
    rename), and clean revised/original inputs each carry at most one of
    `w:t` / `w:delText` per run, so no interleaving occurs.
  * `normalizeText` mirrors `normalizeText` (`trackChangesAcceptorAst.ts:701-711`):
    here modeled over the paragraph list (one entry per paragraph) rather than a
    flat `String`. The two load-bearing behaviours are kept: each entry is
    trimmed, and blank entries are dropped — the structured analogue of the
    `\n+ → \n` collapse plus outer `trim`. The intra-line multi-space/tab collapse
    the TS regex also performs is NOT modeled here; that extensional gap to the
    literal regex is a documented Tier-2.5-class residual (it is absorbed by the
    residual axiom `compareDocumentXml_output_text_roundtrip`, which asserts
    equality *post-`normalizeText`*, and is exercised against the live TS
    `normalizeText` by the bridge fixture).

Per-paragraph text is modeled as `List Char` (and the document as a
`List (List Char)`) rather than `String`. This is a faithful, more-primitive view
of a string and avoids depending on the `String`-internals reduction behaviour of
the toolchain; the only `String` touchpoint is reading an atom's payload via
`String.toList` in `atomText`.

The machine-checked content here is what `Spec.lean` composes with the single
named residual axiom to close `inv_rt_001`. As of #347 that law is stated
projection-to-projection: accept-all of `combined` recovers accept-all of the
revised input, and reject-all of `combined` recovers reject-all of the original
input (NOT the inputs' raw extracted text, which on a pre-tracked input counts
both `w:t` and `w:delText` and is neither projection). The lemmas below are
therefore applied on BOTH `combined` and the inputs; they are unchanged by the
restatement:

  * `text_rename_invariant` — `reject`'s global `delText → text` /
    `delInstrText → instrText` rename pass does not change extracted text, since
    `extractText` already counts `delText` (`trackChangesAcceptorAst.ts:677-682`).
  * `extractText_reject` — `extractText (reject d)` equals the original-side
    projection `originalText d` exactly (no normalization needed; `reject` does
    not drop paragraphs).
  * `extractText_accept_normalized` — `extractText (accept d)` equals the
    revised-side projection `revisedText d` *after* `normalizeText`. `accept`
    keeps every paragraph (a body that collapses to empty leaves an empty text
    entry); `normalizeText` drops those blank entries from both aligned sides via
    its `if normLine t != []` branch. This blank-entry absorption is the reason
    `inv_rt_001` is stated post-`normalizeText`.
-/
import Tier2.AcceptReject

namespace Tier2.RoundTripText

open Tier2.OoxmlModel Tier2.AcceptReject

/-- A run of extracted text (the characters of one paragraph, in document order). -/
abbrev Line : Type := List Char

/-! ### Text extraction -/

/-- The text payload of one atom. Mirrors which OOXML leaf elements
    `extractTextWithParagraphs` collects: `w:t`, `w:delText` and `w:sym` carry
    text; `w:instrText` / `w:delInstrText` / `w:fldChar` do not
    (`trackChangesAcceptorAst.ts:698-772`). A `sym` atom already holds the
    character resolved from `w:sym/@w:char`, so it contributes exactly what the
    same glyph spelled literally inside a `w:t` would contribute. -/
def atomText : Atom → Line
  | .text s => s.toList
  | .delText s => s.toList
  | .instrText _ => []
  | .delInstrText _ => []
  | .fldChar _ => []
  | .sym s => s.toList

/-- The concatenated text of an atom list. -/
def atomsText (as : List Atom) : Line :=
  (as.map atomText).flatten

/-- The concatenated text of a block sequence, descending through every wrapper
    (`ins`/`del`/`moveFrom`/`moveTo`) and transparent `other` container. Like the
    TS `findAllByTagName(p, 'w:t' | 'w:delText')` this gathers all text descendants
    regardless of tag (`trackChangesAcceptorAst.ts:665-683`); unlike TS it keeps
    structural document order rather than all-`w:t`-then-all-`w:delText` (see the
    module header's Tier 2.5 ordering note). -/
def paraTextBlocks : List Block → Line
  | [] => []
  | .run r :: rest => atomsText r.content ++ paraTextBlocks rest
  | .ins bs :: rest => paraTextBlocks bs ++ paraTextBlocks rest
  | .del bs :: rest => paraTextBlocks bs ++ paraTextBlocks rest
  | .moveFrom bs :: rest => paraTextBlocks bs ++ paraTextBlocks rest
  | .moveTo bs :: rest => paraTextBlocks bs ++ paraTextBlocks rest
  | .other _ bs :: rest => paraTextBlocks bs ++ paraTextBlocks rest
termination_by bs => sizeOf bs

/-- `extractTextWithParagraphs` — one entry per paragraph, in document order. -/
def extractText (d : Doc) : List Line :=
  d.map fun p => paraTextBlocks p.body

theorem extractText_cons (p : Paragraph) (ps : Doc) :
    extractText (p :: ps) = paraTextBlocks p.body :: extractText ps := rfl

/-- The revised-side text projection: the per-paragraph text of `acceptBlocks`
    (drop `del`/`moveFrom`, unwrap `ins`/`moveTo`). One entry per paragraph,
    matching `extractText (accept d)` now that `accept` keeps every paragraph. -/
def revisedText (d : Doc) : List Line :=
  d.map fun p => paraTextBlocks (acceptBlocks p.body)

theorem revisedText_cons (p : Paragraph) (ps : Doc) :
    revisedText (p :: ps) = paraTextBlocks (acceptBlocks p.body) :: revisedText ps := rfl

/-- The original-side text projection: the per-paragraph text of `rejectBlocks`
    (drop `ins`/`moveTo`, unwrap `del`/`moveFrom`), before the rename pass. -/
def originalText (d : Doc) : List Line :=
  d.map fun p => paraTextBlocks (rejectBlocks p.body)

/-! ### Normalization (paragraph-list model) -/

/-- ASCII whitespace, matching the characters the TS `normalizeText` regex
    family treats as whitespace (`\r`, `\n`, `\t`, space). -/
def isWsChar (c : Char) : Bool := c == ' ' || c == '\t' || c == '\n' || c == '\r'

/-- Per-entry normalization: trim leading/trailing whitespace. Models the
    `trim`-and-line-strip half of the TS `normalizeText`; the intra-line
    multi-space/tab collapse is NOT modeled and is the documented residual
    (see module header). -/
def normLine (s : Line) : Line :=
  ((s.dropWhile isWsChar).reverse.dropWhile isWsChar).reverse

/-- `normalizeText` over the paragraph list: trim each entry, drop blanks. The
    blank-drop is the structured analogue of `\n+ → \n` plus outer `trim`. -/
def normalizeText (xs : List Line) : List Line :=
  (xs.map normLine).filter (· != [])

theorem normLine_empty : normLine [] = [] := rfl

/-- `normalizeText` determined entrywise by `normLine` of the head and the
    normalization of the tail. -/
theorem normalizeText_cons (t : Line) (xs : List Line) :
    normalizeText (t :: xs)
      = (if normLine t != [] then [normLine t] else []) ++ normalizeText xs := by
  simp only [normalizeText, List.map_cons, List.filter_cons]
  split <;> simp_all

/-- A leading empty entry is invisible to `normalizeText`. -/
theorem normalizeText_cons_empty (xs : List Line) :
    normalizeText ([] :: xs) = normalizeText xs := by
  rw [normalizeText_cons, normLine_empty]
  simp

/-! ### Rename invariance (reject side) -/

theorem atomText_renameAtom (a : Atom) : atomText (renameAtom a) = atomText a := by
  cases a <;> rfl

theorem atomsText_renameAtom (as : List Atom) :
    atomsText (as.map renameAtom) = atomsText as := by
  simp only [atomsText, List.map_map]
  congr 1
  exact List.map_congr_left fun a _ => atomText_renameAtom a

/-- `extractText` is invariant under `reject`'s global `delText → text` /
    `delInstrText → instrText` rename pass. -/
theorem text_rename_invariant (bs : List Block) :
    paraTextBlocks (renameBlocks bs) = paraTextBlocks bs := by
  induction bs using renameBlocks.induct with
  | case1 => simp only [renameBlocks]
  | case2 r rest ih =>
    simp only [renameBlocks, paraTextBlocks, atomsText_renameAtom, ih]
  | case3 bs rest ih1 ih2 =>
    simp only [renameBlocks, paraTextBlocks, ih1, ih2]
  | case4 bs rest ih1 ih2 =>
    simp only [renameBlocks, paraTextBlocks, ih1, ih2]
  | case5 bs rest ih1 ih2 =>
    simp only [renameBlocks, paraTextBlocks, ih1, ih2]
  | case6 bs rest ih1 ih2 =>
    simp only [renameBlocks, paraTextBlocks, ih1, ih2]
  | case7 _ bs rest ih1 ih2 =>
    simp only [renameBlocks, paraTextBlocks, ih1, ih2]

/-- **Reject-side round-trip lemma.** `extractText (reject d)` equals the
    original-side projection exactly. -/
theorem extractText_reject (d : Doc) : extractText (reject d) = originalText d := by
  induction d with
  | nil => rfl
  | cons p ps ih =>
    simp only [extractText, originalText, reject, List.map_cons] at *
    rw [text_rename_invariant, ih]

/-! ### Accept-side round-trip lemma -/

/-- **Accept-side round-trip lemma.** `extractText (accept d)` equals the
    revised-side projection after `normalizeText`. `accept` now preserves every
    paragraph (an empty body yields an empty text entry), and `normalizeText`
    absorbs that empty entry via the `if normLine t != []` branch of
    `normalizeText_cons`, so both sides stay aligned entrywise. -/
theorem extractText_accept_normalized (d : Doc) :
    normalizeText (extractText (accept d)) = normalizeText (revisedText d) := by
  induction d with
  | nil => rfl
  | cons p ps ih =>
    simp only [accept]
    rw [extractText_cons, revisedText_cons, normalizeText_cons, normalizeText_cons, ih]

end Tier2.RoundTripText
