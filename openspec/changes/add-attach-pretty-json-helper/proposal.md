# Change: Add pretty JSON attachment helper for human-readable Allure output

## Why
Current debug JSON attachments are machine-friendly but visually dense for manual review, and the shared helper currently treats debug attachment steps as BDD `AND` steps. The report also needs stricter auto-fit behavior for HTML attachments to avoid nested or unnecessary vertical scrollbars.

## What Changes
- NEW: shared `attachPrettyJson` helper in the Allure test factory for inline, formatted JSON evidence.
- MODIFIED: debug JSON final-step helper to keep neutral evidence wording (no forced `AND:` prefix).
- MODIFIED: branded report HTML attachment sizing to better auto-fit short content and avoid nested vertical scrollbars.
- MODIFIED: targeted pilot tests to use the updated evidence behavior.

## Impact
- Affected specs: `mcp-server`
- Affected code:
  - `testing/allure-test-factory.js`
  - `testing/allure-test-factory.d.ts`
  - `scripts/brand_allure_report.mjs`
  - targeted safe-docx test files that emit evidence attachments
