# Change: Prevent Footnote Double Elevation

## Why
NVCA SPA and similar documents define `FootnoteReference` character styles with both `w:vertAlign="superscript"` and `w:position="6"` in the style's rPr. On Mac Pages and non-Windows renderers, these effects stack — pushing footnote reference numerals too high above the baseline. Working documents (Bylaws) only use `w:vertAlign="superscript"` and render correctly.

## What Changes
- NEW: `prevent_double_elevation.ts` in docx-primitives — pure normalization function that removes redundant `w:position` when `w:vertAlign="superscript"` is present on allowlisted reference styles
- MODIFIED: `namespaces.ts` — add `vertAlign` and `position` constants to `W` object
- MODIFIED: `document.ts` — extend `NormalizationResult` with `doubleElevationsFixed`, integrate into `normalize()` method
- MODIFIED: `index.ts` — re-export new module
- MODIFIED: `open_document.ts` — add `double_elevations_fixed` to normalization stats
- MODIFIED: `get_session_status.ts` — add `double_elevations_fixed` to normalization stats
- MODIFIED: `normalization_regression.test.ts` — update skip payload assertion shape

## Design Decisions
- **Allowlisted styles only**: Default targets are `FootnoteReference` and `EndnoteReference`. General-purpose styles may legitimately use both properties.
- **Nearest-in-chain wins**: Walk basedOn chain; nearest `w:vertAlign` determines effective value. Child `baseline`/`subscript` overrides ancestor `superscript`.
- **Local neutralization, never mutate parents**: If `w:position` is local, remove it. If inherited, add `w:position="0"` locally.
- **Positive-only**: Only positive `w:position` values trigger the fix. Negative values lower text.
- **Run-level out of scope for v1**: Style-only fix. Direct run-level `w:position` overrides are not scanned.

## Non-goals
- Run-level `w:position` scanning
- General-purpose style normalization
- Configurable allowlist via MCP params (v1 uses hardcoded defaults)

## Impact
- Affected specs: `docx-primitives`
- Affected code: `packages/docx-primitives/src/prevent_double_elevation.ts` (new), `packages/docx-primitives/src/namespaces.ts`, `packages/docx-primitives/src/document.ts`, `packages/docx-primitives/src/index.ts`, `packages/safe-docx/src/tools/open_document.ts`, `packages/safe-docx/src/tools/get_session_status.ts`, `packages/safe-docx/src/tools/normalization_regression.test.ts`
