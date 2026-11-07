# Change: Document `_bk_*` paragraph ID stability and add opt-in `content_fingerprint`

## Why

`skills/docx-editing/SKILL.md:187` tells consumers `_bk_*` paragraph IDs are "session-scoped" and must not be persisted across reads. This is wrong: the implementation in `packages/docx-core/src/primitives/bookmarks.ts` is fully deterministic — it prefers Word's intrinsic `w14:paraId`, falls back to a deterministic hash of normalized paragraph text + neighbor context + ancestor chain. Tests already prove byte-identical IDs across reopens, machines, and processes (`update_safe_docx_save_defaults_and_stable_node_ids.test.ts:48`, `normalization_regression.test.ts:45`).

Downstream consumers (`UseJunior/legal-context` PR #213) read the stale doc, discard `_bk_*` IDs, and reinvent a content-addressable marker scheme on top of safe-docx output. This change closes the gap by:

1. Correcting the documentation across SKILL.md, both READMEs, and the OpenSpec corpus.
2. Renaming the legacy `jr_para_*` identifier still referenced throughout `openspec/` to the actual `_bk_*` form the implementation has used since v0.3.
3. Adding an opt-in `content_fingerprint` field on `read_file(format="json")` so citation/archival systems get a portable, recomputable hash without forking safe-docx's internal seed format.

Tracks issues #156 and #1229.

## What Changes

- **Documentation correction (SKILL.md, READMEs)**: replace the "Paragraph IDs are session-scoped" warning with an accurate identifier contract. Consumers MAY persist `_bk_*` IDs across reads of the same document.
- **Spec drift cleanup (OpenSpec)**: rename `jr_para_*` → `_bk_*` everywhere it still appears in `openspec/project.md`, `openspec/specs/mcp-server/spec.md`, and `openspec/specs/docx-primitives/spec.md`. The implementation moved to `_bk_*` long ago; only the specs lagged.
- **Compact paragraph IDs**: newly minted DOCX and Google Docs anchors use 10 hex characters (40 bits), while existing `_bk_*` anchors of any length remain canonical and resolvable. DOCX keeps deterministic salted collision retry; Google Docs skips occupied compact names deterministically.
- **New: opt-in `content_fingerprint`**: `read_file(format="json", include_fingerprint=true)` adds `content_fingerprint: "sha256:nfkc:<16hex>"` to each paragraph node.
  - Algorithm: `sha256(NFKC(visibleText).replace(/\s+/g, " ").trim())`, hex-truncated to 16 chars (64 bits), prefixed `sha256:nfkc:` for forward compatibility. Legacy 32-hex fingerprints remain accepted when resolving persisted locators and Markdoc.
  - Input is the raw paragraph visible text (same `getParagraphText()` surface used by the `_bk_*` fallback seed) — NOT post-processed `clean_text` (which strips list labels and gets enriched with footnote display markers in `read_file.ts`).
  - Read-only metadata. Edit tools (`replace_text`, `insert_paragraph`, `batch_edit`, etc.) continue to accept ONLY `_bk_*` IDs as anchors. `content_fingerprint` is never an edit anchor.
  - Off by default — JSON mode is already token-budgeted.
- **New helper**: `computeContentFingerprint()` in `@usejunior/docx-core` (re-exported from package index for downstream reuse).
- **Generated tool reference**: regenerate `packages/docx-mcp/docs/tool-reference.generated.md` after `tool_catalog.ts` schema change.
- **Google Docs path**: explicitly out of scope for this change. `read_file` for `google_doc_id` inputs silently ignores `include_fingerprint`. A future change MAY mirror the contract on `DocumentViewNodeGdocs`.

## Impact

- **Affected specs**: `mcp-server`, `docx-primitives`.
- **Affected docs**: `skills/docx-editing/SKILL.md`, `README.md`, `packages/docx-mcp/README.md`, `openspec/project.md`.
- **Affected code**:
  - New: `packages/docx-core/src/primitives/content_fingerprint.ts`.
  - Modified: `packages/docx-mcp/src/tool_catalog.ts` (add `include_fingerprint`), `packages/docx-mcp/src/tools/read_file.ts` (thread the flag, populate the field), `packages/docx-core/src/primitives/index.ts` (export the helper).
  - Regenerated: `packages/docx-mcp/docs/tool-reference.generated.md`.
- **New tests**:
  - `packages/docx-core/src/primitives/content_fingerprint.test.ts` (algorithm invariants, golden values).
  - `packages/docx-mcp/src/tools/read_file_content_fingerprint.test.ts` (opt-in semantics, gdocs ignores).
- **Backward compatibility**: existing `_bk_*` bookmarks are never renamed and remain resolvable. Legacy 32-hex `sha256:nfkc:` fingerprints remain valid inputs even though new output uses 16 hex characters.
