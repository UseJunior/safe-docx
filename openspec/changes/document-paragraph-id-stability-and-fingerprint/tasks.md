# Tasks

## 1. OpenSpec deltas

- [x] Draft `specs/mcp-server/spec.md` delta — MODIFY `Persisted Intrinsic Node IDs`, `Tool Feature Parity`, `DocumentView IR and JSON Mode`, `Automatic Document Normalization`, `Revision Extraction Returns Structured Per-Paragraph Diffs` (rename `jr_para_*` → `_bk_*`); ADD `Optional Content Fingerprint on read_file JSON`.
- [x] Draft `specs/docx-primitives/spec.md` delta — MODIFY `Paragraph Bookmark Identity` (rename `jr_para_*` → `_bk_*`, update pattern).
- [x] `openspec validate document-paragraph-id-stability-and-fingerprint --strict` passes.

## 2. Code: content_fingerprint helper

- [x] Create `packages/docx-core/src/primitives/content_fingerprint.ts` exporting `computeContentFingerprint(rawVisibleText: string): string`.
- [x] Re-export from `packages/docx-core/src/primitives/index.ts` (and therefore from the package barrel `packages/docx-core/src/index.ts`).
- [x] Algorithm: `sha256(text.normalize('NFKC').replace(/\s+/g, ' ').trim())`, take first 32 hex chars, prefix `sha256:nfkc:`.

## 3. Code: read_file wiring

- [x] Add `include_fingerprint: z.boolean().optional()` to the `read_file` schema in `packages/docx-mcp/src/tool_catalog.ts` with a description noting it's read-only and not an edit anchor.
- [x] Thread `include_fingerprint` through `packages/docx-mcp/src/tools/read_file.ts`. When true and `format === 'json'` (and DOCX path, not gdocs), compute the fingerprint per paragraph from the raw visible text (`getParagraphText(paragraphEl)`) and attach as a transport-layer field on each JSON node.
- [x] Confirm gdocs path silently ignores the flag (no field emitted on `DocumentViewNodeGdocs`).
- [x] Regenerate `packages/docx-mcp/docs/tool-reference.generated.md` via `npm run docs:generate:tools -w @usejunior/docx-mcp`.

## 4. Tests

- [x] `packages/docx-core/src/primitives/content_fingerprint.test.ts`:
  - Output format: starts with `sha256:nfkc:` and has exactly 32 hex chars after.
  - NFKC normalization: ligatures (`ﬁ` → `fi`) produce the same fingerprint as the spelled-out form.
  - Compatibility whitespace: NBSP collapses to single space (NFKC-then-`\s+`-collapse).
  - Whitespace collapse: multiple spaces, tabs, line breaks → single space.
  - Trim: leading/trailing whitespace is stripped before hashing.
  - Case is preserved: "Section 5" and "section 5" produce different fingerprints.
  - Determinism: golden values for a few sample strings (so cross-machine drift is caught).
- [x] `packages/docx-mcp/src/tools/read_file_content_fingerprint.test.ts`:
  - `format="json"` + `include_fingerprint=true` adds `content_fingerprint` to each paragraph.
  - `format="json"` without the flag omits the field.
  - `format="toon"` ignores the flag (TOON output unaffected).
  - Same paragraph text in two different documents produces the same fingerprint.
  - Editing a paragraph's text changes its fingerprint (regression check).

## 5. Documentation

- [x] Replace `skills/docx-editing/SKILL.md:187-189` ("Paragraph IDs are session-scoped") with the accurate identifier contract: intrinsic `w14:paraId` → `_bk_<hex12>`; deterministic; consumers MAY persist; document the opt-in `content_fingerprint`.
- [x] Fix `README.md:66` example so it shows real 12-char hex hashes (`_bk_a3f29c10b8e4`, `_bk_7d2e8f1a4c5b`) instead of the misleading `_bk_1, _bk_2, ...`.
- [x] Add a "Paragraph identity" section to `packages/docx-mcp/README.md` documenting the contract and the `include_fingerprint` flag.
- [x] Rename `jr_para_*` → `_bk_*` in `openspec/project.md:40,71`.

## 6. Verification

- [x] `npm run build` passes.
- [x] `npm run lint --workspaces --if-present` passes.
- [x] `npm test -w @usejunior/docx-core` passes (with new fingerprint tests).
- [x] `npm test -w @usejunior/docx-mcp` passes (with new read_file fingerprint tests).
- [x] `npm run check:tool-docs` passes.
- [x] `npm run check:spec-coverage` passes.
- [x] `openspec validate document-paragraph-id-stability-and-fingerprint --strict` passes.
- [x] Manual smoke: `read_file(file_path, format="json", include_fingerprint=true)` against a real DOCX confirms 32-hex `sha256:nfkc:` fingerprints.

## 7. Cross-repo follow-up (post-merge)

- [ ] Comment on `UseJunior/legal-context` PR #213 noting (a) corrected stability semantics for `_bk_*`, and (b) availability of `content_fingerprint` for portable hashes.
