# Project Context

## Purpose
Safe DOCX Suite is a TypeScript monorepo for safe, formatting-preserving `.docx` editing and comparison.

It ships a package family:

1. `@usejunior/docx-primitives` - DOM and OOXML primitives (parse/edit/serialize, bookmarks, layout mutators)
2. `@usejunior/docx-comparison` - document comparison and tracked-changes generation
3. `@usejunior/safe-docx` - local MCP server + CLI for document editing workflows
4. `safedocx` - unscoped alias package for easier install/use
5. `@usejunior/safedocx-mcpb` - private MCP bundle wrapper for desktop distribution

The core product goal is local-first legal-document editing with deterministic behavior, stable paragraph anchors, and strong round-trip safety guarantees.

## Tech Stack
- TypeScript (ESM) on Node.js (`>=20` at repo root; package minimum currently `>=18`)
- npm workspaces monorepo (`packages/*`)
- `@modelcontextprotocol/sdk` for MCP server transport/contracts
- OOXML/DOCX processing: `@xmldom/xmldom`, `jszip`, `fast-xml-parser`
- Comparison and diffing: `diff-match-patch`
- CLI/runtime utilities: `uuid`, `tsx`
- Testing: `vitest`, `@vitest/coverage-v8`, `allure-vitest`
- Spec-driven process: OpenSpec (`openspec/`)

## Project Conventions

### Code Style
- ESM modules with explicit `.js` import suffixes in TypeScript source.
- Strict TypeScript enabled in all packages (`strict: true`).
- Tool and operation naming follows snake_case for MCP surfaces (`read_file`, `smart_edit`, `format_layout`, etc.).
- File names are mostly lowercase with underscores for tool/test surfaces.
- Keep runtime dependencies Node/TypeScript-only for Safe-Docx runtime (no Python/Aspose runtime requirement).

### Architecture Patterns
- Monorepo package layering:
  - `safe-docx` depends on `docx-primitives` + `docx-comparison`
  - `safedocx` re-exports `safe-docx`
  - `safedocx-mcpb` bundles the server for MCP desktop distribution
- Paragraph identity is bookmark-based (`jr_para_*`) and treated as canonical anchor identity.
- Session-first editing model with file-first entry support (`session_id` or `file_path`).
- Deterministic tool contracts with structured success/error payloads.
- OpenSpec scenarios are mapped to tests with traceability validation.

### Testing Strategy
- Unit tests for OOXML primitives and comparison algorithms.
- Integration tests for MCP tools and editing workflows.
- Allure-tagged scenario tests for OpenSpec traceability.
- Conformance harness (`packages/safe-docx/conformance/`) for deterministic fixture evidence.
- CI gates include:
  - `npm run build`
  - `npm run test`
  - package smoke suites (`test:run` per package)
  - OpenSpec traceability check (`npm run check:spec-coverage`)
  - coverage ratchet enforcement (`npm run coverage:packages:check`)

### Git Workflow
- Default branch: `main`.
- Conventional Commit style is used (`feat:`, `fix:`, `refactor:`, `chore:`).
- Release pipeline is tag-driven via GitHub Actions (`.github/workflows/release.yml`).
- npm publishing uses Trusted Publishing (OIDC), not long-lived npm tokens.
- Package publish order matters for dependency graph:
  1. `@usejunior/docx-primitives`
  2. `@usejunior/docx-comparison`
  3. `@usejunior/safe-docx`
  4. `safedocx`

## Domain Context
- `.docx` is OOXML in ZIP containers; Word commonly splits visible text across many runs.
- Legal documents require high formatting fidelity and stable references across edits.
- Safe-Docx exposes stable paragraph anchors (`jr_para_*`) to avoid fragile index-based targeting.
- Download workflows support both clean and tracked-change artifacts for legal review.
- This package is local execution oriented for editing trust boundaries (stdio/local MCP runtime), not a hosted remote editor endpoint.

## Important Constraints
- Preserve round-trip fidelity: unchanged content should survive parse/edit/serialize safely.
- Preserve non-body parts (headers, footers, notes, comments, relationships) during edits.
- Enforce path policy and symlink bounds for filesystem safety.
- Guard against hostile/corrupt archives (entry count, size, compression-ratio limits).
- Keep strict-mode operations transactional: validation failures must not partially mutate sessions.
- Maintain OpenSpec scenario coverage alignment; spec drift should fail validation checks.

## Gotchas (Learned the Hard Way)

### Word run fragmentation makes naive string replacement unsafe
Visible text may span many `w:r` nodes with mixed formatting; matching and edits must preserve run-level structure.

### `open_document` exists but file-first tool calls are the primary workflow
Most document tools support `file_path` directly and auto-resolve/reuse sessions.

### Session reuse can be implicit
When a file already has an active session, file-first calls may reuse it; callers should check session metadata.

### Download overwrite protection is deliberate
`download` should not overwrite the originally opened file unless explicit overwrite opt-in is provided.

### Publish/release checks are strict
Release preflight verifies tag/version alignment, npm duplicates, build/tests, coverage ratchet, and pack dry-runs.

### OpenSpec scope still includes historical capabilities
`openspec/specs/` currently includes `open-agreements` plus Safe DOCX capabilities (`mcp-server`, `docx-primitives`, `docx-comparison`). Treat Safe DOCX package specs as the active implementation baseline for this repo.

## External Dependencies
- [Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk) - MCP server/client primitives
- [xmldom](https://www.npmjs.com/package/@xmldom/xmldom) - DOM-compatible XML parsing for OOXML
- [JSZip](https://www.npmjs.com/package/jszip) - DOCX archive read/write
- [fast-xml-parser](https://www.npmjs.com/package/fast-xml-parser) - XML parsing in comparison pipelines
- [diff-match-patch](https://www.npmjs.com/package/diff-match-patch) - text diff foundation
- [Vitest](https://vitest.dev/) - test runner
- [Allure Vitest](https://www.npmjs.com/package/allure-vitest) - traceability reporting
