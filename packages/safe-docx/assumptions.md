# Safe-Docx Assumptions and Test Matrix

This document makes the key implementation assumptions explicit and maps each one to concrete verification.

## How to Use

1. Run the listed command(s).
2. Confirm the expected outcome.
3. If an assumption fails, treat it as a release blocker.

## Assumption Matrix

| ID | Assumption | Why it matters | How to test | Command | Expected result |
|---|---|---|---|---|---|
| A1 | `format_layout` only changes OOXML layout geometry, not text content | Prevents accidental clause/content edits | Automated integration scenario: `Scenario: format paragraph spacing by paragraph ID` plus document XML inspection | `npm run test:run -w @usejunior/safedocx -- test/add_safe_docx_layout_format_controls.allure.test.ts -t "format paragraph spacing by paragraph ID"` | Test passes and only spacing attrs are mutated |
| A2 | Layout operations do not insert spacer paragraphs | Prevents fake whitespace hacks and paragraph drift | Automated integration scenario: `Scenario: no spacer paragraphs are introduced` | `npm run test:run -w @usejunior/safedocx -- test/add_safe_docx_layout_format_controls.allure.test.ts -t "no spacer paragraphs are introduced"` | Test passes; paragraph count unchanged |
| A3 | Existing paragraph IDs remain stable after layout formatting | Anchor IDs must remain valid for subsequent edits | Automated integration scenario: `Scenario: paragraph IDs remain stable after layout formatting` | `npm run test:run -w @usejunior/safedocx -- test/add_safe_docx_layout_format_controls.allure.test.ts -t "paragraph IDs remain stable after layout formatting"` | Test passes; ID list before/after is equal |
| A4 | Strict mode rejects invalid selectors before mutating the active session | Avoids partial edits and hard-to-debug state | Automated validation + strict preflight in tool code (`src/tools/format_layout.ts`) | `npm run test:run -w @usejunior/safedocx -- test/add_safe_docx_layout_format_controls.allure.test.ts` | Invalid selector/value tests fail cleanly with structured errors; no partial mutation |
| A5 | Invalid units/enums are rejected with structured errors | Deterministic, safe API contract | Automated integration scenario: `Scenario: invalid layout values are rejected with structured error` | `npm run test:run -w @usejunior/safedocx -- test/add_safe_docx_layout_format_controls.allure.test.ts -t "invalid layout values are rejected with structured error"` | Test passes with `VALIDATION_ERROR` |
| A6 | Runtime remains Node/TS only (no Python/Aspose runtime dependency) | Keeps install/use friction low and predictable | Automated package metadata check scenario: `Scenario: npx runtime remains Python-free` | `npm run test:run -w @usejunior/safedocx -- test/add_safe_docx_layout_format_controls.allure.test.ts -t "npx runtime remains Python-free"` | Test passes and dependency metadata contains no Python/Aspose runtime deps |
| A7 | Build-time external tooling is optional, not required | Runtime behavior must not depend on local proprietary tools | Automated doc policy check scenario: `Scenario: build-time tooling may be external but optional` | `npm run test:run -w @usejunior/safedocx -- test/add_safe_docx_layout_format_controls.allure.test.ts -t "build-time tooling may be external but optional"` | Test passes and README documents optional build-time usage |
| A8 | Core OOXML container creation is safe and preserves unrelated formatting | Prevents style corruption when adding spacing/margins | Automated unit tests in `packages/docx-primitives/test/layout.test.ts` | `npm run test:run -w @usejunior/docx-primitives -- test/layout.test.ts` | Tests pass; `pPr/trPr/tcPr` created as needed; unrelated nodes preserved |
| A9 | OpenSpec scenario coverage for this feature is complete | Prevents drift between spec and tests | Automated traceability matrix generation/validation | `npm run check:spec-coverage -w @usejunior/safedocx` | `PASS add-safe-docx-layout-format-controls` with all scenarios covered |
| A10 | Package builds and end-to-end suites pass in current repo state | Baseline release confidence | Full build/test + spec validation | `npm run build -w @usejunior/safedocx`<br>`npm run test:run -w @usejunior/safedocx`<br>`npm run test:run -w @usejunior/docx-primitives`<br>`openspec validate add-safe-docx-layout-format-controls --strict` | All commands pass |

## Additional Fundamental Assumptions (Now Explicit)

These are deeper package-level assumptions beyond the layout feature. They should be treated as durability and safety guarantees for Safe-Docx behavior.

| ID | Assumption | Status | Why it matters | How to test | Planned/Current test target |
|---|---|---|---|---|---|
| A11 | Round-trip OOXML fidelity is safe when there are no content edits | Covered | Parser/serializer drift can silently damage legal docs | Open+download without edits; compare canonical XML for core parts | `test/assumption_round_trip_fidelity.test.ts` |
| A12 | Non-body package parts are preserved across edit workflows | Covered | Headers/footers/footnotes/comments/customXml must not be corrupted when editing body | Edit `document.xml`; assert non-body parts unchanged | `test/assumption_non_body_part_preservation.test.ts` |
| A13 | Strict mode failures are transactional (no partial mutation) | Covered | Failed operations must not leave session in partially edited state | Trigger strict selector error; compare before/after XML + edit_revision | `test/assumption_strict_transactionality.test.ts` |
| A14 | Complex Word structures survive round-trip/edit flows | Planned | Fields/content controls/hyperlinks/bookmarks can break despite valid XML | Add specialized fixture corpus and structure assertions | Planned fixture suite |
| A15 | Cross-editor compatibility holds (Word/LibreOffice/Google import) | Planned | Valid OOXML may still trigger repair dialogs or layout breakage | Multi-editor smoke suite over generated artifacts | Planned manual+CI matrix |
| A16 | Paragraph ID generation remains collision-safe in extreme docs | Covered | ID collisions break anchor-based editing | Large near-duplicate corpora + deterministic reopen checks | `test/assumption_paragraph_id_collision_safety.test.ts` |
| A17 | Matching/replacement is Unicode-grapheme safe | Covered | Incorrect splitting can corrupt non-ASCII legal text | Emoji/RTL/combining-mark replacement fixtures | `test/assumption_unicode_grapheme_safety.test.ts` |
| A18 | Concurrent operations on a session are deterministic | Covered | Race conditions can cause state corruption | Concurrent tool-call tests with repeatable final-state checks | `test/assumption_concurrency_determinism.test.ts` |
| A19 | Session cleanup and temp artifacts are bounded | Covered | Long-running use can leak disk/memory | Session clear/clear_all artifact cleanup assertions | `test/assumption_session_cleanup_bounds.test.ts` |
| A20 | Path/symlink handling matches security expectations | Covered | Unexpected traversal can violate sandbox/user intent | Allowed-root + symlink-escape blocking tests | `test/assumption_path_policy_symlink_bounds.test.ts` |
| A21 | Malformed/hostile docx inputs are bounded safely | Covered | Zip/XML bombs can cause DOS or crashes | Compression-ratio guard rejection tests | `test/assumption_archive_guard_limits.test.ts` |
| A22 | Redline semantics are acceptable for legal-review workflows | Planned | “Diff exists” is weaker than review-usable legal redline quality | Goldens for anchor placement and expected tracked changes | Planned redline quality suite |

### Quick Commands for Covered Additional Assumptions

- A11: `npm run test:run -w @usejunior/safedocx -- test/assumption_round_trip_fidelity.test.ts`
- A12: `npm run test:run -w @usejunior/safedocx -- test/assumption_non_body_part_preservation.test.ts`
- A13: `npm run test:run -w @usejunior/safedocx -- test/assumption_strict_transactionality.test.ts`
- A16: `npm run test:run -w @usejunior/safedocx -- test/assumption_paragraph_id_collision_safety.test.ts`
- A17: `npm run test:run -w @usejunior/safedocx -- test/assumption_unicode_grapheme_safety.test.ts`
- A18: `npm run test:run -w @usejunior/safedocx -- test/assumption_concurrency_determinism.test.ts`
- A19: `npm run test:run -w @usejunior/safedocx -- test/assumption_session_cleanup_bounds.test.ts`
- A20: `npm run test:run -w @usejunior/safedocx -- test/assumption_path_policy_symlink_bounds.test.ts`
- A21: `npm run test:run -w @usejunior/safedocx -- test/assumption_archive_guard_limits.test.ts`

## Manual Smoke Test (Recommended)

Use this when touching layout selectors or table-index logic:

1. Open a representative `.docx` containing:
   - normal paragraphs
   - at least one table with 2+ rows and 2+ cells
2. Run `read_file` and capture a baseline list of `jr_para_*` IDs.
3. Apply `format_layout` with:
   - `paragraph_spacing` on 1-2 known paragraph IDs
   - `row_height` on one table row
   - `cell_padding` on one table cell
4. Run `read_file` again and confirm:
   - same paragraph count
   - same `jr_para_*` IDs
5. Run `download` and inspect the output in Word:
   - spacing/padding changed as expected
   - text content unchanged
   - no extra blank paragraphs inserted

## Current Evidence Snapshot

Most recent full verification run:

- `openspec validate add-safe-docx-layout-format-controls --strict` -> pass
- `npm run test:run -w @usejunior/docx-primitives` -> pass
- `npm run test:run -w @usejunior/safedocx` -> pass
- `npm run build -w @usejunior/safedocx` -> pass
