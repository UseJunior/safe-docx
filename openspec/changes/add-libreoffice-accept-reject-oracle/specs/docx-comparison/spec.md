## ADDED Requirements

### Requirement: The differential harness validates accept/reject paragraph collapse against a LibreOffice oracle

The Lean↔TS helper differential SHALL validate its pinned accept/reject paragraph-collapse cases against
**LibreOffice** as an independent reference implementation, so the paragraph-collapse claims are oracle-backed
ground truth rather than only Lean↔TS self-consistency. The harness SHALL drive LibreOffice headless through
the native `.uno:AcceptAllTrackedChanges` / `.uno:RejectAllTrackedChanges` dispatches (via an injected Basic
macro, since pyuno is blocked on macOS), batching all pinned cases through a single launch.

The oracle comparison SHALL be **structural** — the number of body paragraphs and which paragraphs collapsed
to empty (carry no visible text) — NOT the full revision/formatting token projection, because LibreOffice
rewrites styles and run properties, and on a contrived nested revision (`w:ins` wrapping `w:del`) it interprets
the change differently from the Lean/TS model (it keeps the inserted-then-deleted text on accept where Lean/TS
collapse to empty). The harness SHALL assert the claim the oracle is authoritative for — that an UNTRACKED
paragraph mark is kept and a `PPR-INS`/`PPR-DEL` mark is dropped — and SHALL pin, rather than hide, the
nested-revision content divergence so a change in LibreOffice's behavior is detected.

The oracle voter SHALL be gated on the presence of a LibreOffice binary (`resolveSoffice()`, with a
`SAFE_DOCX_SOFFICE_BIN` override) and SHALL skip cleanly with a clear message when it is absent — CI does not
install LibreOffice, so the voter is a local developer check. It SHALL ALSO skip cleanly when LibreOffice is
present but cannot launch (for example a sandboxed shell on macOS, where `soffice` aborts before doing any
work): the harness catches the launch failure, logs why, and no-ops the assertions rather than failing, since
the oracle is best-effort ground truth — it runs fully only where a working LibreOffice can be driven. This
requirement adds reference-implementation evidence only; it introduces no production-engine change.

#### Scenario: [LEAN-HELP-09] LibreOffice keeps an untracked-mark paragraph (kept-not-dropped), matching the TS engine

- **GIVEN** the pinned G3 (accept), G4 (reject), and G5 (accept) fixtures, each an untracked-mark paragraph whose body collapses to empty, followed by a surviving paragraph
- **WHEN** each is run through LibreOffice and through the TS engine
- **THEN** LibreOffice and the TS engine keep the same number of paragraphs (the untracked-mark paragraph is kept, not dropped); and the contrived nested-revision G3 content divergence (LibreOffice keeps the inserted-then-deleted text on accept while the TS engine collapses to empty) is asserted explicitly as a characterized difference

#### Scenario: [LEAN-HELP-10] LibreOffice and the TS engine agree on full paragraph structure for the clean single-level fixtures

- **GIVEN** the clean single-level fixtures — G4 (an `ins`-only paragraph, reject) and G5 (a `del`-only paragraph, accept)
- **WHEN** each is run through LibreOffice and through the TS engine
- **THEN** the resulting paragraph structure is identical in both — the collapsed paragraph is kept as an empty `<w:p>` and the survivor remains — confirming the mark-based collapse against the reference implementation

#### Scenario: [LEAN-HELP-11] LibreOffice drops a PPR-marked paragraph, matching the TS engine

- **GIVEN** a paragraph whose mark is `PPR-INS` (reject side) and a paragraph whose mark is `PPR-DEL` (accept side), each followed by a surviving paragraph
- **WHEN** each is run through LibreOffice and through the TS engine
- **THEN** both LibreOffice and the TS engine remove the marked paragraph, leaving only the survivor — confirming the other direction of the mark-based rule against the reference implementation

### Requirement: The LibreOffice oracle's trust boundary is characterized — accept/reject is trustworthy, the save round-trip is not, and the projection is formatting-blind

The harness SHALL characterize, as committed gated tests, the boundary of what the LibreOffice oracle can be
trusted for (vetted on LibreOffice 25.8.7.3, 2026-06):

1. **Trustworthy — resolved accept/reject text and paragraph shape**, including for stacked multi-author
   revisions (`w:del` + `w:ins` siblings from different authors) and inline `w:del`-nested-in-`w:ins` shapes,
   whether the nested deletion consumes all or part of the insertion. The oracle dispatches
   `.uno:AcceptAllTrackedChanges` / `.uno:RejectAllTrackedChanges` BEFORE `storeToURL`, so no unresolved
   tracked change ever reaches LibreOffice's DOCX save and the save defect below cannot reach the voting path.
2. **NOT trustworthy — the plain save round-trip for unresolved tracked changes.** For a FULLY-deleted
   insertion (`<w:ins authorA><w:del authorB>…all of the inserted text…</w:del></w:ins>`, no surviving
   inserted text) a plain load→save silently drops the `<w:ins>` wrapper, collapsing "inserted then deleted"
   into "original text deleted". The harness SHALL NOT use the LibreOffice save round-trip to validate
   fully-deleted-insertion shapes; it SHALL use safe-docx's own deterministic projections instead. The oracle
   helper SHALL expose an `identity` op (load→save, no dispatch) so the defect stays pinned as a
   characterization: if a future LibreOffice release fixes it, the test trips and the boundary note is
   re-vetted.
3. **Blind — formatting.** The structural projection (`paragraphShape`) records only paragraph count and
   visible-text presence by design, so the oracle cannot guard formatting fidelity (tracked separately by the
   formatting-fidelity-oracle work).

#### Scenario: [LO-ORACLE-TRUST-01] LibreOffice resolves a simple insertion and a simple deletion to the expected text on accept and reject, matching the TS engine

- **GIVEN** a paragraph with untracked text plus a single-author `w:ins` (and, separately, a single-author `w:del`)
- **WHEN** each is resolved via the oracle's accept and reject ops and via the TS engine
- **THEN** both engines produce the expected resolved text and the same paragraph shape — the baseline the rest of the boundary is measured against

#### Scenario: [LO-ORACLE-TRUST-02] LibreOffice resolves a fully-deleted insertion to a collapse on BOTH accept and reject — the oracle dispatches before saving, so the save defect cannot reach it

- **GIVEN** a paragraph with untracked text plus an insertion whose entire content is consumed by a nested deletion (`<w:ins><w:del>…</w:del></w:ins>`)
- **WHEN** it is resolved via the oracle's accept and reject ops and via the TS engine
- **THEN** the inserted-then-deleted text vanishes on accept AND on reject in both engines, and the paragraph keeps its untracked text — demonstrating the oracle's voting path is insulated from the save defect

#### Scenario: [LO-ORACLE-TRUST-03] LibreOffice resolves stacked multi-author revisions correctly: a del+ins stack discriminates accept (NEW) from reject (ORIG), and a partial del-in-ins keeps the surviving inserted text

- **GIVEN** a non-nested multi-author stack (`<w:del A>ORIG</w:del><w:ins B>NEW</w:ins>`) and a partial deletion inside an insertion with surviving inserted text (`AB[CD]EF`)
- **WHEN** each is resolved via the oracle's accept and reject ops and via the TS engine
- **THEN** accept yields `NEW` / `ABEF` and reject yields `ORIG` / empty in both engines — a discriminating pair that a silently-failed dispatch could not pass — and the emptied partial-reject paragraph survives per the mark-based rule

#### Scenario: [LO-ORACLE-TRUST-04] LibreOffice save round-trip (no accept/reject) drops the w:ins wrapper of a fully-deleted insertion — characterized defect; stacked and partial shapes round-trip cleanly

- **GIVEN** the fully-deleted-insertion fixture plus the stack and partial fixtures, each run through the oracle's `identity` op (load→save, no dispatch)
- **WHEN** the saved `word/document.xml` is inspected
- **THEN** the fully-deleted insertion has lost its `<w:ins>` wrapper (a bare `<w:del>` with the original `delText` remains — the characterized LibreOffice defect), while the stack and partial controls retain both their `w:del` and `w:ins` revisions and their visible text unchanged
