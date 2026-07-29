# Design: Nested text-box story comparison

## Context

The atomizer can see descendant text under `w:txbxContent`, but treating those
atoms as members of the outer `w:body` comparison lets reconstruction place
revision markup around the containing `w:pict`/shape. Microsoft Word rejects
that output. The current preflight hash guard therefore rejects every changed
text box.

The first supported subset is deliberately narrow:

- VML text boxes in `word/document.xml`;
- the same number and order of boxes on both sides;
- unchanged scaffold outside each `w:txbxContent`;
- non-nested WordprocessingML paragraph content inside the box; and
- text/run/paragraph edits representable by the existing in-place comparison.

## Decisions

### 1. Treat each `w:txbxContent` as a nested story

Each story receives a locator containing the package part and document-order
ordinal, with paragraph/shape identifiers retained as diagnostics when present.
Outer-body comparison must not infer correspondence between text-box content
and ordinary body text.

### 2. Separate scaffold identity from story content identity

Before comparison, each paired text box is split into:

- the preserved outer scaffold, compared after replacing nested content with a
  deterministic neutral placeholder; and
- the nested WordprocessingML story, compared independently.

The implementation may publish only when the scaffolds are semantically equal.
This prevents a text edit from turning into deletion/insertion of the complete
drawing object.

### 3. Reuse comparison semantics, not a second diff implementation

Nested stories use the same atomization, LCS, revision construction, and
accept/reject logic as the main document. Story orchestration may wrap the
paragraph sequence in a temporary WordprocessingML body, but it must not
reimplement tokenization or revision semantics.

### 4. Validate the assembled output as a triple

After splicing each compared story into the preserved scaffold:

- accept-all must recover the revised outer document and revised text-box
  stories under the normal comparison projection;
- reject-all must recover the original outer document and original text-box
  stories; and
- field, bookmark, relationship, and consumer-openability checks continue to
  apply to the assembled package.

### 5. Fail closed outside the accepted subset

Inserted/deleted/reordered text boxes, changed VML/DrawingML scaffold, nested
text boxes, and text boxes in headers/footers are not silently flattened or
ignored. They retain a typed unsupported-story diagnostic with a stable locator.

### 6. Keep verifier coverage honest

The compiled verifier must either check each supported text-box story or return
a structured uncovered-story item. A successful document comparison is not yet
a full verifier certificate until this coverage item is discharged.

## Alternatives considered

- **Remove the safety gate and rely on current atomization.** Rejected because
  the prior corruption reproduction produced a Word-unreadable drawing-level
  revision.
- **Treat changed text boxes as opaque delete/insert objects.** Rejected because
  revision markup around VML objects is not a reliable Word-readable redline.
- **Implement separate text tokenization for text boxes.** Rejected because it
  would duplicate comparison semantics and create a drift-prone second engine.

## Risks

- Temporary story wrapping can lose namespace or relationship context. The
  splice step therefore preserves the original scaffold and effective namespace
  declarations.
- Story order alone is insufficient when boxes are inserted or reordered. This
  slice rejects those cases rather than guessing.
- Recursive pipeline use can recurse through nested boxes. Nested discovery is
  explicitly rejected and internal story comparison runs on isolated paragraph
  content with no text-box descendants.
