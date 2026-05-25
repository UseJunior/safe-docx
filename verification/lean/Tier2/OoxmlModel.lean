/-
Tier 2 — definitional OOXML subset.

A small, tree-structured syntactic subset of the `document.xml` surface, mirroring
OOXML's nested track-change wrappers. The `accept` / `reject` operations and the
field-structure predicate are defined against this subset so they match the
production engine structurally rather than abstractly.

Field-line citations point at the production engine:
`packages/docx-core/src/baselines/atomizer/trackChangesAcceptorAst.ts`.

See `openspec/changes/add-ooxml-doc-subset-and-inv-field-001-proof/design.md`
for the rejected alternatives (flat tape; full `ComparisonUnitAtom` projection).
-/

namespace Tier2.OoxmlModel

/-- `w:fldChar` field-character kinds (`w:fldCharType` attribute).
    `begin` / `separate` / `endf` mirror OOXML `begin` / `separate` / `end`
    (`endf` because `end` is a Lean keyword). -/
inductive FldCharKind
  | begin
  | separate
  | endf
  deriving DecidableEq, Repr, Inhabited

/-- A logical run-level atom. `instrText` / `delInstrText` are treated as single
    logical atoms even though production OOXML can fragment them across sibling
    `w:r` elements — we model the post-atomization view as canonical.

    `delText` / `delInstrText` are the deleted-content counterparts the engine
    rewrites back to `text` / `instrText` on `reject`
    (`trackChangesAcceptorAst.ts:602-616`). -/
inductive Atom
  | text (s : String)
  | delText (s : String)
  | instrText (s : String)
  | delInstrText (s : String)
  | fldChar (k : FldCharKind)
  deriving DecidableEq, Repr, Inhabited

/-- Opaque run-properties marker. `inv_field_001` does not depend on `w:rPr`
    contents, so this carries no internal structure. -/
structure RPr where
  marker : Nat := 0
  deriving DecidableEq, Repr, Inhabited

/-- A `w:r` run: properties plus an ordered list of atoms. -/
structure Run where
  rPr : RPr := {}
  content : List Atom
  deriving DecidableEq, Repr, Inhabited

/-- A block-level element inside a paragraph body.

    Track-change wrapper types (`ins` / `del` / `moveFrom` / `moveTo`) are the
    only kinds the accept/reject semantics act on. `other` is a transparent
    container that models every other OOXML structural element that can hold
    block-level content but does NOT alter the field-context walk semantically
    (`w:tbl`, `w:tr`, `w:tc`, `w:sdt`, `w:sdtContent`, `w:hyperlink`,
    `w:bookmarkStart`/`End`, etc.). The walk, accept, reject, and rename
    operations all descend transparently through `other`; `wrapperSubtreesBlocks`
    skips `other` because it is not a track-change wrapper. -/
inductive Block
  | run (r : Run)
  | ins (children : List Block)
  | del (children : List Block)
  | moveFrom (children : List Block)
  | moveTo (children : List Block)
  | other (tag : String) (children : List Block)
  deriving Repr, Inhabited

/-- Opaque paragraph-properties marker. -/
structure PPr where
  marker : Nat := 0
  deriving DecidableEq, Repr, Inhabited

/-- A `w:p` paragraph: properties plus an ordered list of blocks. -/
structure Paragraph where
  pPr : PPr := {}
  body : List Block
  deriving Repr, Inhabited

/-- The modeled `document.xml` surface: an ordered list of paragraphs. -/
abbrev Doc := List Paragraph

/-- The whole-document block sequence in document order: every paragraph body
    concatenated. The field-structure walk runs over this. -/
def Doc.blocks (d : Doc) : List Block :=
  d.flatMap Paragraph.body

end Tier2.OoxmlModel
