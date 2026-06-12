## Context
SafeDocX now emits native OOXML revision markup during AI writes. Real user documents may already contain malformed third-party tracked changes, so validation must distinguish session-emitted revision markup from pre-existing defects.

## Goals / Non-Goals
- Goals: validate AI-emitted revision attributes and element placement, keep revision id seeding and validation vocabulary aligned, roll back failed AI writes, and block saves that contain session-caused revision errors.
- Non-Goals: package-wide invariant validation beyond the current revision and global marker checks, and fixing root comment text in `comments.xml` to be tracked-change wrapped.

## Decisions
- Decision: `RevisionIdState.startId` records the first session-owned revision id. Defects on revision elements with `w:id >= startId` are errors; defects on lower ids are warnings.
- Decision: session open computes a baseline of existing validation issue fingerprints and tainted marker ids after normalization and bookmark bootstrapping.
- Decision: global marker/field defects become errors only when they involve session-created ids or clean-at-open marker ids. Baseline taint and fingerprint membership are consulted BEFORE numeric session-range attribution, and numeric attribution applies only to marker families allocated from the revision id space (move ranges, customXml ranges) — comment and permission marker ids live in independent id spaces and can numerically overlap the session range without being session-emitted.
- Decision: MCP write tools snapshot `document.xml`, relevant side parts, caches, and the revision id allocator before mutation and restore them on validation failure.
- Decision: `apply_plan` has no outer transaction; it delegates to guarded step tools so previous successful steps remain applied if a later step fails.
- Decision: `accept_changes` is outside the guard because it consumes existing revision markup rather than emitting AI revision markup.
- Decision: docx-core enforces the contract itself: every `DocxDocument` write method that accepts a `RevisionContext` asserts session-scoped revision validity post-write and throws `RevisionValidationError`. MCP paths that drive lower-level primitives directly (tracked `replaceParagraphTextRange`) call `validateAfterExternalRevisionWrite` immediately after the primitive. Tool catch handlers map `RevisionValidationError` to `REVISION_VALIDATION_FAILED` after rolling back, so the error code is identical whichever layer detects the defect.

## Risks / Trade-offs
- False positives can brick real-document editing, so severity is scoped by session revision id and baseline taint.
- Baseline taint is keyed by bare marker id across marker families so a defect that changes manifestation (unmatched start becoming unmatched end) stays masked; the cost is that an id collision across marker families can downgrade a genuinely new defect to a warning. Masking errs toward under-blocking, never toward bricking edits.
- Snapshot rollback has runtime cost, but it is linear in the package parts currently mutated by MCP tools and comparable to existing per-write document view rebuild work.
