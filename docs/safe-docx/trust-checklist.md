# Safe Docx Trust Checklist

This checklist is the central trust artifact for the local Safe Docx MCP runtime in this repo.

## Quick Decision

- If you are editing `.docx` files, use local Safe Docx runtime: `npx -y @usejunior/safe-docx`
- If you need hosted template filling, use a separate remote template workflow (not the local Safe Docx editor runtime)

## Trust Boundary

| Mode | Where processing runs | What leaves device | Recommended use |
| --- | --- | --- | --- |
| Local Safe Docx MCP runtime (`@usejunior/safe-docx`) | Local machine only | No Safe Docx hosted editor endpoint hop | Contract edits, review workflows, tracked changes, local-first document handling |
| Separate remote template workflow | Hosted service | Structured template payloads for that workflow | Template convenience where remote processing is acceptable |

## Current Reliability Evidence

- Package trust boundary and runtime behavior:
  - `packages/safe-docx/README.md`
- Assumption-to-test mapping:
  - `packages/safe-docx/assumptions.md`
- Conformance assets and schemas:
  - `packages/safe-docx/conformance/README.md`
  - `packages/safe-docx/conformance/fixtures.manifest.json`
  - `packages/safe-docx/conformance/fixtures.manifest.schema.v1.json`
  - `packages/safe-docx/conformance/report.schema.v1.json`
- Sprint 3 conformance guide:
  - `docs/safe-docx/sprint-3-conformance.md`

## Scope

In scope for this checklist:

- Local runtime trust boundary clarity
- Reproducible conformance evidence
- Deterministic editing expectations and failure reporting

Out of scope for this checklist:

- Hosted runtime operational policy for non-local products
- Cross-editor compatibility matrix execution across all office suites
- Commercial positioning or competitive analysis
