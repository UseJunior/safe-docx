## Context
SafeDocX now emits native OOXML revision markup during AI writes. Real user documents may already contain malformed third-party tracked changes, so validation must distinguish session-emitted revision markup from pre-existing defects.

## Goals / Non-Goals
- Goals: validate AI-emitted revision attributes and element placement, keep revision id seeding and validation vocabulary aligned, roll back failed AI writes, and block saves that contain session-caused revision errors.
- Non-Goals: package-wide invariant validation beyond the current revision and global marker checks, and fixing root comment text in `comments.xml` to be tracked-change wrapped.

## Decisions
- Decision: `RevisionIdState.startId` records the first session-owned revision id. Defects on revision elements with `w:id >= startId` are errors; defects on lower ids are warnings.
- Decision: session open computes a baseline of existing validation issue fingerprints and tainted marker ids after normalization and bookmark bootstrapping.
- Decision: global marker/field defects become errors only when they involve session-created ids or clean-at-open marker ids.
- Decision: MCP write tools snapshot `document.xml`, relevant side parts, caches, and the revision id allocator before mutation and restore them on validation failure.
- Decision: `apply_plan` has no outer transaction; it delegates to guarded step tools so previous successful steps remain applied if a later step fails.
- Decision: `accept_changes` is outside the guard because it consumes existing revision markup rather than emitting AI revision markup.

## Risks / Trade-offs
- False positives can brick real-document editing, so severity is scoped by session revision id and baseline taint.
- Snapshot rollback has runtime cost, but it is linear in the package parts currently mutated by MCP tools and comparable to existing per-write document view rebuild work.
