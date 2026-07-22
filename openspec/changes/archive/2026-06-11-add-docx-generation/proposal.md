# Change: Add from-scratch DOCX generation to @usejunior/docx-core

## Why

Issue #280 recognizes from-scratch generation as a strategic capability: today safe-docx
owns the rewrite path (surgical manipulation, comparison, tracked changes) but delegates
the write path to third-party emitters, so downstream products carry two OOXML models with
impedance mismatches between them. Bringing generation in-house gives consumers one library
that owns both paths against the same canonical model, and extends the ECMA-376 conformance
discipline already applied to manipulation (citation registry, structural validators,
LibreOffice oracle) to document construction. This change re-prioritizes #280 from backlog
and delivers the full "feature complete" checklist from that issue.

## What Changes

- New declarative `DocumentSpec` recipe API in `@usejunior/docx-core` under
  `src/generation/` (library-only; the MCP `generate_document` tool surface is explicitly
  out of scope and follows once the spec shape settles). The spec is plain JSON-serializable
  data so it can later back an MCP recipe payload without translation.
- Emission of: sections with distinct headers/footers (cover page → body); PAGE/NUMPAGES
  fields with required cached result text (no reader recovery dialogs); named paragraph
  styles + styles.xml; tables with cell borders, column widths, fixed layout; tabular
  cover-terms blocks and signature blocks (as recipes over table primitives); multi-level
  numbering + numbering.xml; run-level rPr formatting; page size/margins/section breaks/page
  numbering; drafting notes as a separable comment layer.
- Structural "no recovery dialog" validation (package closure, field pairing, sectPr
  invariants) plus a full-package LibreOffice identity/PDF probe and a recorded manual
  compatibility matrix (Word for Mac, Pages, Google Docs import, LibreOffice).
- New coverage validator wiring the `docx-generation` capability into
  `check:spec-coverage` (report-only during the phased rollout, strict at completion).
- Repositioning sweep: README, site FAQ, docx-editing skill, LLM-gate system prompt, and
  conformance-registry prose currently state from-scratch generation is out of scope.

## Impact

- Affected specs: `docx-generation` (new capability, ADDED requirements only)
- Affected code: `packages/docx-core/src/generation/**` (new),
  `packages/docx-core/src/integration/libreoffice-oracle.ts` (additive probe helper),
  `packages/docx-core/scripts/validate_generation_openspec_coverage.mjs` (new),
  `packages/docx-core/package.json` + root `package.json` (gate wiring),
  `spec-compliance/registry/ecma-376.md` (new section entries),
  `README.md`, `site/src/_data/faq.js`, `skills/docx-editing/SKILL.md`, `AGENTS.md`,
  `.github/llm-based-quality-gate/system-prompt.md` (positioning)
- Delivery: phased multi-PR sequence (one tasks.md section per PR), each PR shippable,
  `Ref: #280` per phase and `Fixes: #280` on the final phase
