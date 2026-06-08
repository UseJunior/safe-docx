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
