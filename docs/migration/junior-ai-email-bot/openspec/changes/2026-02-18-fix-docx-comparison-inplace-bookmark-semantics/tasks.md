## 1. Implementation

- [x] 1.1 Replace strict bookmark-ID equality in inplace safety checks with semantic bookmark diagnostics parity.
- [x] 1.2 Capture bookmark reference targets (`REF` / `PAGEREF`) and unresolved-reference diagnostics in fallback details.
- [x] 1.3 Preserve paragraph-boundary bookmark markers when creating inplace deleted/moved-source paragraphs.
- [x] 1.4 Keep fallback-to-rebuild behavior for genuine round-trip safety failures.

## 2. Regression Tests

- [x] 2.1 Add/adjust integration tests for reconstruction metadata (inplace success corpus + fallback corpus).
- [x] 2.2 Add/adjust integration stability tests for deterministic fallback diagnostics and read_text invariants.
- [x] 2.3 Add Allure-style integration tests for semantic bookmark parity and fallback behavior.

## 3. Validation

- [x] 3.1 Run `npm run lint -w @junior/docx-comparison`.
- [x] 3.2 Run targeted integration tests for reconstruction metadata and stability invariants.
- [x] 3.3 Run the new Allure-style integration regression suite.
- [x] 3.4 Run `openspec validate fix-docx-comparison-inplace-bookmark-semantics --strict`.
