# Change: Remove Lean verification from Safe DOCX

## Why

The compiled Lean checker has unacceptable real-document latency and requires a
separate toolchain/binary that npm consumers do not receive. Keeping it in the
product, release certificate, CI, and conformance surface creates a required
gate that is neither portable nor predictably bounded.

## What Changes

- **BREAKING** Remove the compiled Lean checker, Lean sources, build workflow,
  audits, registries, and differential harnesses.
- **BREAKING** Remove Lean verifier options, certificate fields, exports, CLI
  flags, and environment-variable discovery.
- Preserve emitted-redline LCS minimality as a required, independently
  implemented TypeScript release-verifier gate over finished artifacts.
- Remove formal-verification claims and Lean-backed evidence references from
  current specifications, conformance registries, generated trust surfaces,
  documentation, and active OpenSpec changes.
- Keep independent TypeScript accept-all/reject-all, LCS minimality,
  archive/package, comment, formatting, renderer, authorization, and
  human-review gates.
- Preserve the comparison and DOCX mutation algorithms themselves; this change
  removes one verifier implementation, not document safety checks generally.

## Impact

- Affected specs: `docx-comparison`, `spec-compliance`, pending
  `release-verification`.
- Affected code: `verification/lean`, `packages/docx-compare`,
  `packages/docx-release-verifier`, `packages/docx-mcp`, CI workflows, root
  scripts, conformance registries, and documentation.
- Migration: callers must remove Lean-specific options. Release-verifier
  callers continue to receive a required `minimality` gate, now computed
  locally without a toolchain or subprocess.
